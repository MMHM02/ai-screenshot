use base64::{Engine as _, engine::general_purpose};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
}

/// Return metadata for all connected monitors.
pub fn get_monitors_info() -> Result<Vec<MonitorInfo>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
    Ok(monitors
        .iter()
        .map(|m| MonitorInfo {
            id: m.id(),
            name: m.name().to_string(),
            x: m.x(),
            y: m.y(),
            width: m.width(),
            height: m.height(),
            is_primary: m.is_primary(),
            scale_factor: m.scale_factor(),
        })
        .collect())
}

/// Capture a single monitor by id. If `monitor_id` is None, captures the primary.
pub fn capture_monitor(monitor_id: Option<u32>) -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let target = match monitor_id {
        Some(id) => monitors
            .iter()
            .find(|m| m.id() == id)
            .ok_or(format!("Monitor {} not found", id))?,
        None => monitors
            .iter()
            .find(|m| m.is_primary())
            .or(monitors.first())
            .ok_or("No primary monitor found")?,
    };

    capture_monitor_image(target)
}

/// Capture all monitors as a single stitched image (full virtual desktop).
pub fn capture_all_monitors() -> Result<String, String> {
    use xcap::{Monitor, image};

    let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    // Compute bounding rectangle of all monitors
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let x = m.x();
        let y = m.y();
        let w = m.width() as i32;
        let h = m.height() as i32;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
    }

    let total_w = (max_x - min_x) as u32;
    let total_h = (max_y - min_y) as u32;

    // Capture each monitor and stitch into one image
    let mut canvas = image::RgbaImage::new(total_w, total_h);

    for m in &monitors {
        let img = m.capture_image().map_err(|e| format!("Failed to capture monitor: {}", e))?;
        let offset_x = (m.x() - min_x) as u32;
        let offset_y = (m.y() - min_y) as u32;
        image::imageops::overlay(&mut canvas, &img, offset_x as i64, offset_y as i64);
    }

    encode_to_base64(&canvas)
}

fn capture_monitor_image(monitor: &xcap::Monitor) -> Result<String, String> {
    let image = monitor.capture_image().map_err(|e| format!("Failed to capture: {}", e))?;
    encode_to_base64(&image)
}

fn encode_to_base64(image: &xcap::image::RgbaImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buffer, image.width(), image.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| format!("PNG header error: {}", e))?;
        writer.write_image_data(image.as_raw()).map_err(|e| format!("PNG write error: {}", e))?;
    }
    Ok(general_purpose::STANDARD.encode(&buffer))
}

