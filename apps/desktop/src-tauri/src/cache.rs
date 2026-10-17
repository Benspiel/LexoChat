//! Encrypted local cache files (XChaCha20-Poly1305). The key is random and lives
//! in the Credential Manager, so a copied cache directory is useless on another
//! machine / Windows account. The cache never contains plaintext messages.

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use std::path::PathBuf;
use tauri::Manager;
use zeroize::Zeroize;

use crate::secrets;

const MAX_SIZE: usize = 2 * 1024 * 1024;

fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("cache");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    // only simple names (no path traversal)
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid cache name".into());
    }
    Ok(dir(app)?.join(format!("{name}.bin")))
}

fn key() -> Result<[u8; 32], String> {
    let mut k = [0u8; 32];
    match secrets::get("cache-key")? {
        Some(h) => {
            let mut bytes = hex::decode(h).map_err(|e| e.to_string())?;
            if bytes.len() != 32 {
                return Err("invalid cache key".into());
            }
            k.copy_from_slice(&bytes);
            bytes.zeroize();
        }
        None => {
            rand::thread_rng().fill_bytes(&mut k);
            secrets::set("cache-key", &hex::encode(k))?;
        }
    }
    Ok(k)
}

pub fn write(app: &tauri::AppHandle, name: &str, data: &str) -> Result<(), String> {
    if data.len() > MAX_SIZE {
        return Err("cache entry too large".into());
    }
    let mut k = key()?;
    let cipher = XChaCha20Poly1305::new((&k).into());
    k.zeroize();
    let mut nonce = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: data.as_bytes(),
                aad: name.as_bytes(),
            },
        )
        .map_err(|_| "encryption failed".to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    let path = file(app, name)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, out).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}

pub fn read(app: &tauri::AppHandle, name: &str) -> Result<Option<String>, String> {
    let path = file(app, name)?;
    let raw = match std::fs::read(&path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if raw.len() < 24 {
        return Ok(None);
    }
    let mut k = key()?;
    let cipher = XChaCha20Poly1305::new((&k).into());
    k.zeroize();
    match cipher.decrypt(
        XNonce::from_slice(&raw[..24]),
        Payload {
            msg: &raw[24..],
            aad: name.as_bytes(),
        },
    ) {
        Ok(plain) => Ok(Some(String::from_utf8(plain).map_err(|e| e.to_string())?)),
        // tampered or created with another key: treat as empty
        Err(_) => Ok(None),
    }
}

pub fn clear(app: &tauri::AppHandle) -> Result<(), String> {
    let d = dir(app)?;
    std::fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
    secrets::delete("cache-key")
}
