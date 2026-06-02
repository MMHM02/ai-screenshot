#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem, WindowEvent,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::thread;

mod screenshot;

// =============================================================================
// Win32 FFI: Hotkey
// =============================================================================

extern "system" {
    fn RegisterHotKey(hwnd: *mut std::ffi::c_void, id: i32, fsModifiers: u32, vk: u32) -> i32;
    fn UnregisterHotKey(hwnd: *mut std::ffi::c_void, id: i32) -> i32;
    fn GetMessageW(msg: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, msg_filter_min: u32, msg_filter_max: u32) -> i32;
    fn GetCurrentThreadId() -> u32;
    fn PostThreadMessageW(idThread: u32, msg: u32, wParam: usize, lParam: isize) -> i32;
}

const MOD_ALT: u32 = 0x0001;
const MOD_CONTROL: u32 = 0x0002;
const MOD_SHIFT: u32 = 0x0004;
const MOD_WIN: u32 = 0x0008;
const WM_HOTKEY: u32 = 0x0312;
const WM_USER_REHOTKEY: u32 = 0x0400 + 100;

const HOTKEY_FULLSCREEN: i32 = 1;
const HOTKEY_REGION: i32 = 2;
const HOTKEY_TOGGLE: i32 = 3;

// =============================================================================
// Win32 FFI: DWM (Desktop Window Manager)
// =============================================================================

#[link(name = "dwmapi")]
extern "system" {
    fn DwmExtendFrameIntoClientArea(hWnd: *mut std::ffi::c_void, pMarInset: *const i32) -> i32;
    fn DwmSetWindowAttribute(
        hwnd: *mut std::ffi::c_void,
        dwAttribute: u32,
        pvAttribute: *const u32,
        cbAttribute: u32,
    ) -> i32;
}

const DWMWA_NCRENDERING_POLICY: u32 = 2;
const DWMNCRP_DISABLED: u32 = 1;
const DWMWA_BORDER_COLOR: u32 = 34;
const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;

// =============================================================================
// Win32 FFI: Window style manipulation
// =============================================================================

const GWL_STYLE: i32 = -16;
const GWL_EXSTYLE: i32 = -20;
const WS_VISIBLE: u32 = 0x10000000;
const WS_POPUP: u32 = 0x80000000;
const WS_BORDER: u32 = 0x00800000;
const WS_CAPTION: u32 = 0x00C00000;
const WS_THICKFRAME: u32 = 0x00040000;
const WS_MINIMIZEBOX: u32 = 0x00020000;
const WS_MAXIMIZEBOX: u32 = 0x00010000;
const WS_EX_TOOLWINDOW: u32 = 0x00000080;

const SWP_NOMOVE: u32 = 0x0002;
const SWP_NOSIZE: u32 = 0x0001;
const SWP_NOZORDER: u32 = 0x0004;
const SWP_FRAMECHANGED: u32 = 0x0020;

extern "system" {
    fn GetWindowLongW(hWnd: *mut std::ffi::c_void, nIndex: i32) -> i32;
    fn SetWindowLongW(hWnd: *mut std::ffi::c_void, nIndex: i32, dwNewLong: i32) -> i32;
    fn SetWindowPos(
        hWnd: *mut std::ffi::c_void,
        hWndInsertAfter: *mut std::ffi::c_void,
        x: i32, y: i32, cx: i32, cy: i32, uFlags: u32,
    ) -> i32;
}

// =============================================================================
// Win32 FFI: Window subclassing (comctl32)
// =============================================================================

#[link(name = "comctl32")]
extern "system" {
    fn InitCommonControlsEx(pInitCtrls: *const INITCOMMONCONTROLSEX) -> i32;
    fn SetWindowSubclass(
        hWnd: *mut std::ffi::c_void,
        pfnSubclass: SUBCLASSPROC,
        uIdSubclass: usize,
        dwRefData: usize,
    ) -> i32;
    fn DefSubclassProc(
        hWnd: *mut std::ffi::c_void,
        uMsg: u32,
        wParam: usize,
        lParam: isize,
    ) -> isize;
}

type SUBCLASSPROC = Option<unsafe extern "system" fn(
    *mut std::ffi::c_void, u32, usize, isize, usize, usize,
) -> isize>;

const WM_NCCALCSIZE: u32 = 0x0083;
const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;

#[repr(C)]
struct INITCOMMONCONTROLSEX {
    dw_size: u32,
    dw_icc: u32,
}

// =============================================================================
// Win32 FFI: Registry (auto-start)
// =============================================================================

const HKEY_CURRENT_USER: *mut std::ffi::c_void = 0x80000001 as *mut std::ffi::c_void;
const KEY_SET_VALUE: u32 = 0x0002;
const KEY_QUERY_VALUE: u32 = 0x0001;
const REG_SZ: u32 = 1;
const ERROR_SUCCESS: i32 = 0;

#[link(name = "advapi32")]
extern "system" {
    fn RegOpenKeyExW(
        hKey: *mut std::ffi::c_void,
        lpSubKey: *const u16,
        ulOptions: u32,
        samDesired: u32,
        phkResult: *mut *mut std::ffi::c_void,
    ) -> i32;
    fn RegSetValueExW(
        hKey: *mut std::ffi::c_void,
        lpValueName: *const u16,
        reserved: u32,
        dwType: u32,
        lpData: *const u8,
        cbData: u32,
    ) -> i32;
    fn RegDeleteValueW(
        hKey: *mut std::ffi::c_void,
        lpValueName: *const u16,
    ) -> i32;
    fn RegCloseKey(hKey: *mut std::ffi::c_void) -> i32;
    fn RegQueryValueExW(
        hKey: *mut std::ffi::c_void,
        lpValueName: *const u16,
        lpReserved: *mut u32,
        lpType: *mut u32,
        lpData: *mut u8,
        lpcbData: *mut u32,
    ) -> i32;
}

// =============================================================================
// Window decoration stripping
// =============================================================================

unsafe extern "system" fn borderless_subclass_proc(
    hwnd: *mut std::ffi::c_void,
    msg: u32,
    wparam: usize,
    lparam: isize,
    _uidsubclass: usize,
    _dwrefdata: usize,
) -> isize {
    match msg {
        // Remove non-client area entirely
        WM_NCCALCSIZE if wparam != 0 => 0,
        // Suppress non-client painting (borders, shadows)
        WM_NCPAINT => 0,
        // Always report as "active" to prevent DWM title bar flash
        WM_NCACTIVATE => 1,
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

/// Strip native window decorations (border, shadow, title bar) via Win32 + DWM.
/// Keeps WS_POPUP | WS_VISIBLE for proper rendering.
fn strip_window_decorations(hwnd: *mut std::ffi::c_void) {
    unsafe {
        // Strip decoration styles, ensure WS_POPUP | WS_VISIBLE
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let new_style = (style & !(WS_CAPTION | WS_BORDER | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX))
            | WS_POPUP | WS_VISIBLE;
        SetWindowLongW(hwnd, GWL_STYLE, new_style as i32);

        // Mark as tool window (no taskbar entry)
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongW(hwnd, GWL_EXSTYLE, (ex_style | WS_EX_TOOLWINDOW) as i32);

        // Tell DWM to stop rendering non-client area
        DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, &DWMNCRP_DISABLED, 4);

        // Remove DWM border (Windows 11)
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &DWMWA_COLOR_NONE, 4);

        // Apply style changes
        SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);

        // Remove DWM shadow via negative margins
        let margins: [i32; 4] = [-1, -1, -1, -1];
        DwmExtendFrameIntoClientArea(hwnd, margins.as_ptr());

        // Subclass to intercept WM_NCCALCSIZE/WM_NCPAINT/WM_NCACTIVATE
        SetWindowSubclass(hwnd, Some(borderless_subclass_proc), 1, 0);
    }
}

/// Strip decorations from a Tauri window by label. No-op if window or hwnd not found.
fn strip_app_window_decorations(app: &tauri::AppHandle, label: &str) {
    if let Some(win) = app.get_window(label) {
        if let Ok(hwnd) = win.hwnd() {
            strip_window_decorations(hwnd.0 as *mut std::ffi::c_void);
        }
    }
}

// =============================================================================
// Data types
// =============================================================================

#[derive(Clone, Serialize)]
struct ScreenshotEvent {
    #[serde(rename = "type")]
    event_type: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct HotkeyConfig {
    full_screen: String,
    region: String,
    toggle_float_ball: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct FloatBallChatPayload {
    #[serde(rename = "imageBase64")]
    image_base64: Option<String>,
    #[serde(rename = "userMessage")]
    user_message: String,
    #[serde(rename = "aiResponse")]
    ai_response: String,
}

use std::sync::atomic::{AtomicBool, Ordering};

struct AppState {
    float_ball_visible: Mutex<bool>,
    current_hotkeys: Mutex<Option<HotkeyConfig>>,
    hotkey_thread_id: Mutex<Option<u32>>,
    hotkeys_paused: AtomicBool,
    float_ball_panel_position: Mutex<Option<(i32, i32)>>,
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
fn show_float_ball(state: tauri::State<AppState>, handle: tauri::AppHandle) -> Result<(), String> {
    let mut visible = state.float_ball_visible.lock().map_err(|e| e.to_string())?;
    if let Some(window) = handle.get_window("float-ball") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().ok();
        *visible = true;
        Ok(())
    } else {
        Err("Float ball window not found".to_string())
    }
}

#[tauri::command]
fn hide_float_ball(state: tauri::State<AppState>, handle: tauri::AppHandle) -> Result<(), String> {
    let mut visible = state.float_ball_visible.lock().map_err(|e| e.to_string())?;
    if let Some(window) = handle.get_window("float-ball") {
        window.hide().map_err(|e| e.to_string())?;
        *visible = false;
    }
    Ok(())
}

#[tauri::command]
fn is_float_ball_visible(state: tauri::State<AppState>) -> Result<bool, String> {
    state.float_ball_visible.lock().map(|v| *v).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_screenshot(capture_all: Option<bool>) -> Result<String, String> {
    if capture_all.unwrap_or(false) {
        screenshot::capture_all_monitors().map_err(|e| e.to_string())
    } else {
        screenshot::capture_monitor(None).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_monitors_info() -> Result<Vec<screenshot::MonitorInfo>, String> {
    screenshot::get_monitors_info().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_crop_overlay(handle: tauri::AppHandle, image_base64: String) -> Result<(), String> {
    if let Some(window) = handle.get_window("crop-overlay") {
        // Position crop overlay on the same monitor as the float ball (fix #22)
        let mut placed = false;
        if let Some(fb) = handle.get_window("float-ball") {
            if let Ok(pos) = fb.outer_position() {
                // Use xcap to find which monitor contains the float ball
                if let Ok(monitors) = xcap::Monitor::all() {
                    for m in &monitors {
                        let mx = m.x();
                        let my = m.y();
                        let mw = m.width() as i32;
                        let mh = m.height() as i32;
                        if pos.x >= mx && pos.x < mx + mw && pos.y >= my && pos.y < my + mh {
                            window.set_position(tauri::PhysicalPosition::new(mx, my)).ok();
                            window.set_size(tauri::PhysicalSize::new(mw as u32, mh as u32)).ok();
                            placed = true;
                            break;
                        }
                    }
                }
            }
        }
        // Fallback: use Tauri's first available monitor
        if !placed {
            if let Ok(monitors) = window.available_monitors() {
                if let Some(monitor) = monitors.first() {
                    let size = monitor.size();
                    window.set_position(tauri::PhysicalPosition::new(0, 0)).ok();
                    window.set_size(tauri::PhysicalSize::new(size.width, size.height)).ok();
                }
            }
        }
        window.emit("crop-image", image_base64).map_err(|e| e.to_string())?;
        strip_app_window_decorations(&handle, "crop-overlay");
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_crop_overlay(handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = handle.get_window("crop-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn complete_crop(handle: tauri::AppHandle, cropped_base64: String) -> Result<(), String> {
    if let Some(window) = handle.get_window("crop-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    if let Some(w) = handle.get_window("float-ball-panel") {
        w.emit("crop-result", cropped_base64).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Position panel near float ball, hide float ball, show panel.
/// Uses saved position if the user has previously dragged the panel.
/// Otherwise calculates a position relative to the float ball.
fn position_and_show_panel(handle: &tauri::AppHandle) -> Result<(), String> {
    let ball_pos = handle.get_window("float-ball")
        .ok_or("Float ball window not found")?
        .outer_position().map_err(|e| e.to_string())?;

    if let Some(fb) = handle.get_window("float-ball") {
        fb.hide().map_err(|e| e.to_string())?;
    }

    if let Some(panel) = handle.get_window("float-ball-panel") {
        // Use saved position if available, otherwise calculate from float ball position
        let saved = handle.try_state::<AppState>()
            .and_then(|s| {
                let guard = s.float_ball_panel_position.lock().ok()?;
                *guard
            });

        let (panel_x, panel_y) = match saved {
            Some((sx, sy)) => {
                // Clamp to screen bounds
                let sx = sx.max(0);
                let sy = sy.max(0);
                (sx, sy)
            }
            None => {
                // Use actual panel size for positioning instead of hardcoded offsets (fix #13)
                let panel_size = panel.outer_size().unwrap_or(tauri::PhysicalSize::new(360, 480));
                let ball_size = 64i32;
                let panel_w = panel_size.width as i32;
                let panel_h = panel_size.height as i32;
                // Position panel above and to the left of the float ball
                (ball_pos.x - (panel_w - ball_size), ball_pos.y - panel_h - ball_size)
            }
        };

        panel.set_position(tauri::PhysicalPosition::new(panel_x, panel_y)).map_err(|e| e.to_string())?;
        strip_app_window_decorations(handle, "float-ball-panel");
        panel.show().map_err(|e| e.to_string())?;
        panel.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn show_float_ball_panel(handle: tauri::AppHandle) -> Result<(), String> {
    position_and_show_panel(&handle)
}

#[tauri::command]
fn save_float_ball_panel_position(state: tauri::State<AppState>, x: i32, y: i32) -> Result<(), String> {
    let mut pos = state.float_ball_panel_position.lock().map_err(|e| e.to_string())?;
    *pos = Some((x, y));
    Ok(())
}

/// Remembers whether the float ball was visible before the panel opened,
/// so we can decide whether to re-show it when the panel closes (fix #12).
fn was_float_ball_visible(state: &AppState) -> bool {
    state.float_ball_visible.lock().map(|v| *v).unwrap_or(true)
}

#[tauri::command]
fn hide_float_ball_panel(state: tauri::State<AppState>, handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(panel_window) = handle.get_window("float-ball-panel") {
        panel_window.hide().map_err(|e| e.to_string())?;
    }
    // Only re-show float ball if it was visible before the panel opened
    if was_float_ball_visible(&state) {
        if let Some(float_ball_window) = handle.get_window("float-ball") {
            float_ball_window.show().map_err(|e| e.to_string())?;
            float_ball_window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_float_ball_position(handle: tauri::AppHandle) -> Result<(i32, i32), String> {
    if let Some(float_ball_window) = handle.get_window("float-ball") {
        let pos = float_ball_window.outer_position().map_err(|e| e.to_string())?;
        Ok((pos.x, pos.y))
    } else {
        Err("Float ball window not found".to_string())
    }
}

#[tauri::command]
fn sync_float_ball_chat(handle: tauri::AppHandle, image_base64: Option<String>, user_message: String, ai_response: String) -> Result<(), String> {
    let payload = FloatBallChatPayload { image_base64, user_message, ai_response };
    handle.emit_to("main", "float-ball-chat", payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_hotkeys(
    state: tauri::State<AppState>,
    hotkeys: HotkeyConfig,
) -> Result<(), String> {
    // Validate all hotkeys before storing (fix #16)
    parse_hotkey(&hotkeys.full_screen)
        .map_err(|e| format!("全屏截图快捷键: {}", e))?;
    parse_hotkey(&hotkeys.region)
        .map_err(|e| format!("区域截图快捷键: {}", e))?;
    parse_hotkey(&hotkeys.toggle_float_ball)
        .map_err(|e| format!("切换悬浮球快捷键: {}", e))?;

    let mut stored_hotkeys = state.current_hotkeys.lock().map_err(|e| e.to_string())?;
    *stored_hotkeys = Some(hotkeys);

    if let Some(thread_id) = *state.hotkey_thread_id.lock().map_err(|e| e.to_string())? {
        unsafe { PostThreadMessageW(thread_id, WM_USER_REHOTKEY, 0, 0); }
    }

    Ok(())
}

#[tauri::command]
fn clear_hotkeys(state: tauri::State<AppState>) -> Result<(), String> {
    *state.current_hotkeys.lock().map_err(|e| e.to_string())? = None;
    if let Some(thread_id) = *state.hotkey_thread_id.lock().map_err(|e| e.to_string())? {
        unsafe { PostThreadMessageW(thread_id, WM_USER_REHOTKEY, 0, 0); }
    }
    Ok(())
}

#[tauri::command]
fn set_hotkeys_paused(state: tauri::State<AppState>, paused: bool) {
    state.hotkeys_paused.store(paused, Ordering::Relaxed);
}

#[tauri::command]
fn set_auto_start(enabled: bool) -> Result<(), String> {
    let value_name = to_wide("AIScreenshot");
    let hkey = open_run_key()?;

    if enabled {
        let exe_path = get_exe_path_wide()?;
        let data_len = (exe_path.len() * 2) as u32;
        let result = unsafe {
            RegSetValueExW(hkey, value_name.as_ptr(), 0, REG_SZ,
                exe_path.as_ptr() as *const u8, data_len)
        };
        unsafe { RegCloseKey(hkey); }
        if result != ERROR_SUCCESS {
            return Err(format!("RegSetValueExW failed: {}", result));
        }
    } else {
        let result = unsafe { RegDeleteValueW(hkey, value_name.as_ptr()) };
        unsafe { RegCloseKey(hkey); }
        if result != ERROR_SUCCESS && result != 2 {
            return Err(format!("RegDeleteValueW failed: {}", result));
        }
    }

    Ok(())
}

#[tauri::command]
fn show_main_window(handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = handle.get_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().ok();
    }
    Ok(())
}

#[tauri::command]
fn is_auto_start_enabled() -> Result<bool, String> {
    let value_name = to_wide("AIScreenshot");
    let subkey = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let mut hkey: *mut std::ffi::c_void = std::ptr::null_mut();
    let result = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey)
    };
    if result != ERROR_SUCCESS {
        return Ok(false);
    }

    let mut buf: [u16; 512] = [0; 512];
    let mut buf_size: u32 = (buf.len() * 2) as u32;
    let mut value_type: u32 = 0;

    let query_result = unsafe {
        RegQueryValueExW(hkey, value_name.as_ptr(), std::ptr::null_mut(),
            &mut value_type, buf.as_mut_ptr() as *mut u8, &mut buf_size)
    };
    unsafe { RegCloseKey(hkey); }

    Ok(query_result == ERROR_SUCCESS)
}

// =============================================================================
// Hotkey parsing
// =============================================================================

fn parse_hotkey(hotkey_str: &str) -> Result<(u32, u32), String> {
    let upper = hotkey_str.to_uppercase();
    let parts: Vec<&str> = upper.split('+').collect();
    let mut modifiers: u32 = 0;
    let mut vk: u32 = 0;

    for part in &parts {
        match part.trim() {
            "CTRL" | "CONTROL" => modifiers |= MOD_CONTROL,
            "ALT" => modifiers |= MOD_ALT,
            "SHIFT" => modifiers |= MOD_SHIFT,
            "WIN" | "WINDOWS" | "SUPER" => modifiers |= MOD_WIN,
            "0" => vk = 0x30, "1" => vk = 0x31, "2" => vk = 0x32,
            "3" => vk = 0x33, "4" => vk = 0x34, "5" => vk = 0x35,
            "6" => vk = 0x36, "7" => vk = 0x37, "8" => vk = 0x38,
            "9" => vk = 0x39,
            "A" => vk = 0x41, "B" => vk = 0x42, "C" => vk = 0x43,
            "D" => vk = 0x44, "E" => vk = 0x45, "F" => vk = 0x46,
            "G" => vk = 0x47, "H" => vk = 0x48, "I" => vk = 0x49,
            "J" => vk = 0x4A, "K" => vk = 0x4B, "L" => vk = 0x4C,
            "M" => vk = 0x4D, "N" => vk = 0x4E, "O" => vk = 0x4F,
            "P" => vk = 0x50, "Q" => vk = 0x51, "R" => vk = 0x52,
            "S" => vk = 0x53, "T" => vk = 0x54, "U" => vk = 0x55,
            "V" => vk = 0x56, "W" => vk = 0x57, "X" => vk = 0x58,
            "Y" => vk = 0x59, "Z" => vk = 0x5A,
            "F1" => vk = 0x70, "F2" => vk = 0x71, "F3" => vk = 0x72,
            "F4" => vk = 0x73, "F5" => vk = 0x74, "F6" => vk = 0x75,
            "F7" => vk = 0x76, "F8" => vk = 0x77, "F9" => vk = 0x78,
            "F10" => vk = 0x79, "F11" => vk = 0x7A, "F12" => vk = 0x7B,
            "SPACE" => vk = 0x20,
            "ENTER" | "RETURN" => vk = 0x0D,
            "TAB" => vk = 0x09,
            "ESC" | "ESCAPE" => vk = 0x1B,
            "BACKSPACE" => vk = 0x08,
            "INSERT" => vk = 0x2D, "DELETE" => vk = 0x2E,
            "HOME" => vk = 0x24, "END" => vk = 0x23,
            "PAGEUP" => vk = 0x21, "PAGEDOWN" => vk = 0x22,
            "UP" => vk = 0x26, "DOWN" => vk = 0x28,
            "LEFT" => vk = 0x25, "RIGHT" => vk = 0x27,
            "`" | "~" => vk = 0xC0,
            "-" | "_" => vk = 0xBD,
            "=" | "+" => vk = 0xBB,
            "[" | "{" => vk = 0xDB,
            "]" | "}" => vk = 0xDD,
            "\\" | "|" => vk = 0xDC,
            ";" | ":" => vk = 0xBA,
            "'" | "\"" => vk = 0xDE,
            "," | "<" => vk = 0xBC,
            "." | ">" => vk = 0xBE,
            "/" | "?" => vk = 0xBF,
            other => {
                return Err(format!("不支持的按键: \"{}\"", other));
            }
        }
    }

    if vk == 0 {
        return Err("快捷键中缺少有效按键".to_string());
    }
    if modifiers == 0 {
        return Err("快捷键需要至少一个修饰键 (Ctrl/Alt/Shift/Win)".to_string());
    }
    Ok((modifiers, vk))
}

// =============================================================================
// Registry helpers
// =============================================================================

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn get_exe_path_wide() -> Result<Vec<u16>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = format!("\"{}\"", exe.display());
    Ok(to_wide(&path))
}

fn open_run_key() -> Result<*mut std::ffi::c_void, String> {
    let subkey = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let mut hkey: *mut std::ffi::c_void = std::ptr::null_mut();
    let result = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE | KEY_QUERY_VALUE, &mut hkey)
    };
    if result != ERROR_SUCCESS {
        return Err(format!("RegOpenKeyExW failed: {}", result));
    }
    Ok(hkey)
}

// =============================================================================
// Hotkey listener thread
// =============================================================================

#[repr(C)]
struct MSG {
    hwnd: *mut std::ffi::c_void,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    pt_x: i32,
    pt_y: i32,
}

fn spawn_hotkey_thread(handle: tauri::AppHandle) {
    thread::spawn(move || {
        let thread_id = unsafe { GetCurrentThreadId() };
        if let Some(state) = handle.try_state::<AppState>() {
            if let Ok(mut tid) = state.hotkey_thread_id.lock() {
                *tid = Some(thread_id);
            }
        }

        let register_hotkeys = || -> Option<()> {
            let state = handle.try_state::<AppState>()?;
            let hotkeys = state.current_hotkeys.lock().ok()?;
            let hotkeys = hotkeys.as_ref()?;
            unsafe {
                UnregisterHotKey(std::ptr::null_mut(), HOTKEY_FULLSCREEN);
                UnregisterHotKey(std::ptr::null_mut(), HOTKEY_REGION);
                UnregisterHotKey(std::ptr::null_mut(), HOTKEY_TOGGLE);
                if let Ok((m, v)) = parse_hotkey(&hotkeys.full_screen) { RegisterHotKey(std::ptr::null_mut(), HOTKEY_FULLSCREEN, m, v); }
                if let Ok((m, v)) = parse_hotkey(&hotkeys.region) { RegisterHotKey(std::ptr::null_mut(), HOTKEY_REGION, m, v); }
                if let Ok((m, v)) = parse_hotkey(&hotkeys.toggle_float_ball) { RegisterHotKey(std::ptr::null_mut(), HOTKEY_TOGGLE, m, v); }
            }
            Some(())
        };

        register_hotkeys();

        loop {
            let mut msg: MSG = unsafe { std::mem::zeroed() };
            let ret = unsafe {
                GetMessageW(&mut msg as *mut MSG as *mut std::ffi::c_void, std::ptr::null_mut(), 0, 0)
            };
            if ret <= 0 { break; }

            if msg.message == WM_USER_REHOTKEY {
                register_hotkeys();
                continue;
            }

            if msg.message == WM_HOTKEY {
                // Skip hotkey processing if paused (e.g. user is recording a new hotkey)
                if let Some(state) = handle.try_state::<AppState>() {
                    if state.hotkeys_paused.load(Ordering::Relaxed) {
                        continue;
                    }
                }
                match msg.w_param as i32 {
                    HOTKEY_FULLSCREEN | HOTKEY_REGION => {
                        let event_type = if msg.w_param as i32 == HOTKEY_FULLSCREEN { "fullScreen" } else { "region" };
                        let _ = position_and_show_panel(&handle);
                        if let Some(panel) = handle.get_window("float-ball-panel") {
                            panel.emit("trigger-screenshot", ScreenshotEvent {
                                event_type: event_type.to_string(),
                            }).ok();
                        }
                    }
                    HOTKEY_TOGGLE => {
                        if let Some(state) = handle.try_state::<AppState>() {
                            if let Ok(mut visible) = state.float_ball_visible.lock() {
                                if *visible {
                                    if let Some(w) = handle.get_window("float-ball") {
                                        w.hide().ok();
                                        *visible = false;
                                    }
                                } else {
                                    if let Some(w) = handle.get_window("float-ball") {
                                        w.show().ok();
                                        w.set_focus().ok();
                                        *visible = true;
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        unsafe {
            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_FULLSCREEN);
            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_REGION);
            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_TOGGLE);
        }
    });
}

// =============================================================================
// System tray
// =============================================================================

fn create_system_tray() -> SystemTray {
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show_window", "显示主窗口"))
        .add_item(CustomMenuItem::new("screenshot", "截图"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "退出"));
    SystemTray::new().with_menu(menu)
}

// =============================================================================
// App entry
// =============================================================================

fn main() {
    unsafe {
        let icc = INITCOMMONCONTROLSEX { dw_size: 8, dw_icc: 0x00000040 };
        InitCommonControlsEx(&icc);
    }

    tauri::Builder::default()
        .manage(AppState {
            float_ball_visible: Mutex::new(true),
            current_hotkeys: Mutex::new(None),
            hotkey_thread_id: Mutex::new(None),
            hotkeys_paused: AtomicBool::new(false),
            float_ball_panel_position: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            take_screenshot,
            get_monitors_info,
            show_float_ball,
            hide_float_ball,
            is_float_ball_visible,
            update_hotkeys,
            show_crop_overlay,
            hide_crop_overlay,
            complete_crop,
            show_main_window,
            show_float_ball_panel,
            hide_float_ball_panel,
            save_float_ball_panel_position,
            get_float_ball_position,
            sync_float_ball_chat,
            set_auto_start,
            is_auto_start_enabled,
            clear_hotkeys,
            set_hotkeys_paused
        ])
        .system_tray(create_system_tray())
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(w) = app.get_window("main") {
                    w.show().ok(); w.unminimize().ok(); w.set_focus().ok();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show_window" => {
                    if let Some(w) = app.get_window("main") {
                        w.show().ok(); w.unminimize().ok(); w.set_focus().ok();
                    }
                }
                "screenshot" => {
                    let _ = position_and_show_panel(app);
                    if let Some(w) = app.get_window("float-ball-panel") {
                        w.emit("trigger-screenshot", ScreenshotEvent {
                            event_type: "fullScreen".to_string(),
                        }).ok();
                    }
                }
                "quit" => { app.exit(0); }
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
            // Only the float ball should be visible at startup.
            // All other windows are visible:false in config and must NOT be touched
            // (no hide(), no strip decorations, no eval) to avoid triggering visibility.

            // Position float ball at right side of screen and show it
            if let Some(fb) = app.get_window("float-ball") {
                if let Ok(monitors) = fb.available_monitors() {
                    if let Some(m) = monitors.first() {
                        fb.set_position(tauri::PhysicalPosition::new(
                            m.size().width as i32 - 80,
                            m.size().height as i32 / 3,
                        )).ok();
                    }
                }
                fb.show().ok();
            }

            // Store default hotkey config
            let state = app.state::<AppState>();
            *state.current_hotkeys.lock().map_err(|e| e.to_string())? = Some(HotkeyConfig {
                full_screen: "Ctrl+Alt+1".to_string(),
                region: "Ctrl+Alt+2".to_string(),
                toggle_float_ball: "Ctrl+Alt+F".to_string(),
            });

            spawn_hotkey_thread(app.handle());

            // Intercept main window close → hide instead of destroy (fix #3, fix #10)
            if let Some(main_window) = app.get_window("main") {
                let w = main_window.clone();
                let app_handle = app.handle();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        w.hide().ok();
                        // Emit event so frontend can show float ball without polling
                        app_handle.emit_all("main-window-minimized", true).ok();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
