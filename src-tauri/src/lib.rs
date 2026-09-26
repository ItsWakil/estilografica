//! Estilográfica backend.
//! Notes are plain `.md` files in `<Documents>/Estilografica`.
//! Deleted notes are moved to `.trash/` inside that folder, never erased.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct NoteMeta {
    id: String,
    modified: u64,
    preview: String,
}

fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("Estilografica");
    fs::create_dir_all(&dir).map_err(|e| format!("Can't create notes folder: {e}"))?;
    Ok(dir)
}

/// Turn a user-typed title into a safe file stem (works on Windows and Linux).
fn clean_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    let upper = cleaned.to_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2", "LPT3"];
    if cleaned.is_empty() || reserved.contains(&upper.as_str()) {
        "Untitled".into()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// Resolve an id to a path, refusing anything that escapes the notes folder.
fn note_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid note name".into());
    }
    Ok(root.join(format!("{id}.md")))
}

/// "Title", "Title 2", "Title 3"… whichever is free.
fn unique_id(root: &Path, base: &str, except: Option<&str>) -> String {
    let mut candidate = base.to_string();
    let mut n = 2;
    while root.join(format!("{candidate}.md")).exists() && Some(candidate.as_str()) != except {
        candidate = format!("{base} {n}");
        n += 1;
    }
    candidate
}

#[tauri::command]
fn notes_dir(app: AppHandle) -> Result<String, String> {
    Ok(notes_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_notes(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    let root = notes_root(&app)?;
    let mut notes = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let preview = fs::read_to_string(&path)
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim_start_matches(['#', '>', '-', '*', ' ']).trim())
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .chars()
            .take(90)
            .collect();
        notes.push(NoteMeta { id, modified, preview });
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
fn read_note(app: AppHandle, id: String) -> Result<String, String> {
    let path = note_path(&notes_root(&app)?, &id)?;
    fs::read_to_string(path).map_err(|e| format!("Can't open “{id}”: {e}"))
}

#[tauri::command]
fn save_note(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let path = note_path(&notes_root(&app)?, &id)?;
    // Write to a temp file then rename, so a crash never leaves a half-written note.
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| format!("Can't save “{id}”: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Can't save “{id}”: {e}"))
}

#[tauri::command]
fn create_note(app: AppHandle) -> Result<String, String> {
    let root = notes_root(&app)?;
    let id = unique_id(&root, "Untitled", None);
    fs::write(note_path(&root, &id)?, "").map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn rename_note(app: AppHandle, id: String, title: String) -> Result<String, String> {
    let root = notes_root(&app)?;
    let from = note_path(&root, &id)?;
    let new_id = unique_id(&root, &clean_title(&title), Some(&id));
    if new_id == id {
        return Ok(id);
    }
    fs::rename(from, note_path(&root, &new_id)?).map_err(|e| format!("Can't rename: {e}"))?;
    Ok(new_id)
}

#[tauri::command]
fn trash_note(app: AppHandle, id: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let from = note_path(&root, &id)?;
    let trash = root.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    fs::rename(from, trash.join(format!("{id} ({stamp}).md"))).map_err(|e| e.to_string())
}

/// Case-insensitive full-text search across titles and contents.
#[tauri::command]
fn search_notes(app: AppHandle, query: String) -> Result<Vec<String>, String> {
    let root = notes_root(&app)?;
    let q = query.to_lowercase();
    let mut hits = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let body = fs::read_to_string(&path).unwrap_or_default().to_lowercase();
        if id.to_lowercase().contains(&q) || body.contains(&q) {
            hits.push(id);
        }
    }
    Ok(hits)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            notes_dir,
            list_notes,
            read_note,
            save_note,
            create_note,
            rename_note,
            trash_note,
            search_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running Estilográfica");
}
