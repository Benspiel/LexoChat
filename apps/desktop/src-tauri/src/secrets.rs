//! Windows Credential Manager (DPAPI protected, per Windows user).

#[cfg(windows)]
const SERVICE: &str = "de.lexichat.desktop";

/// Only a small allow list of keys may be stored.
fn check_key(key: &str) -> Result<(), String> {
    if matches!(key, "session" | "cache-key") {
        Ok(())
    } else {
        Err("unknown secret".into())
    }
}

#[cfg(windows)]
pub fn get(key: &str) -> Result<Option<String>, String> {
    check_key(key)?;
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
pub fn set(key: &str, value: &str) -> Result<(), String> {
    check_key(key)?;
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

#[cfg(windows)]
pub fn delete(key: &str) -> Result<(), String> {
    check_key(key)?;
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- non-Windows development fallback: process memory only -------------------

#[cfg(not(windows))]
static MEMORY: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

#[cfg(not(windows))]
pub fn get(key: &str) -> Result<Option<String>, String> {
    check_key(key)?;
    let m = MEMORY.lock().map_err(|e| e.to_string())?;
    Ok(m.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
}

#[cfg(not(windows))]
pub fn set(key: &str, value: &str) -> Result<(), String> {
    check_key(key)?;
    let mut m = MEMORY.lock().map_err(|e| e.to_string())?;
    m.retain(|(k, _)| k != key);
    m.push((key.to_string(), value.to_string()));
    Ok(())
}

#[cfg(not(windows))]
pub fn delete(key: &str) -> Result<(), String> {
    check_key(key)?;
    MEMORY
        .lock()
        .map_err(|e| e.to_string())?
        .retain(|(k, _)| k != key);
    Ok(())
}
