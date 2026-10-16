import os
import math
from PIL import Image, ImageDraw, ImageFont

def generate_icons(output_dir="icons"):
    os.makedirs(output_dir, exist_ok=True)
    size = 1024
    
    pad = int(size * 0.04)
    radius = int(size * 0.22)
    
    # Rounded rectangle base - Dark sleek background
    bg_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg_img)
    
    bg_draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=(18, 18, 22, 255),
        outline=(50, 50, 58, 255),
        width=max(2, int(size * 0.015))
    )
    
    # Circular progress meter
    cx, cy = size // 2, size // 2
    ring_radius = int(size * 0.35)
    ring_width = int(size * 0.075)
    
    # Track background
    bbox = [cx - ring_radius, cy - ring_radius, cx + ring_radius, cy + ring_radius]
    bg_draw.arc(bbox, start=0, end=360, fill=(45, 20, 24, 255), width=ring_width)
    
    # Active progress arc (72% watched: -90 deg to 170 deg)
    start_angle = -90
    sweep = 260
    end_angle = start_angle + sweep
    
    yt_red = (255, 0, 51, 255)
    bg_draw.arc(bbox, start=start_angle, end=end_angle, fill=yt_red, width=ring_width)
    
    # Rounded ends for progress arc
    def draw_cap(angle_deg):
        rad = math.radians(angle_deg)
        cap_x = cx + ring_radius * math.cos(rad)
        cap_y = cy + ring_radius * math.sin(rad)
        cap_r = ring_width / 2.0
        bg_draw.ellipse([cap_x - cap_r, cap_y - cap_r, cap_x + cap_r, cap_y + cap_r], fill=yt_red)
        
    draw_cap(start_angle)
    draw_cap(end_angle)
    
    # Center Play Triangle (crisp white)
    tri_size = int(size * 0.17)
    tri_cx = cx + int(size * 0.02)
    tri_cy = cy
    p1 = (tri_cx - int(tri_size * 0.7), tri_cy - tri_size)
    p2 = (tri_cx - int(tri_size * 0.7), tri_cy + tri_size)
    p3 = (tri_cx + int(tri_size * 0.9), tri_cy)
    
    bg_draw.polygon([p1, p2, p3], fill=(255, 255, 255, 255))
    
    # Percentage badge in bottom right
    badge_w = int(size * 0.32)
    badge_h = int(size * 0.18)
    badge_x2 = size - pad - int(size * 0.03)
    badge_y2 = size - pad - int(size * 0.03)
    badge_x1 = badge_x2 - badge_w
    badge_y1 = badge_y2 - badge_h
    
    bg_draw.rounded_rectangle(
        [badge_x1, badge_y1, badge_x2, badge_y2],
        radius=int(badge_h * 0.5),
        fill=(255, 0, 51, 255),
        outline=(255, 255, 255, 200),
        width=max(1, int(size * 0.012))
    )
    
    font_path = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'segoeuib.ttf')
    font_size = int(badge_h * 0.65)
    try:
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()
        
    text = "75%"
    t_bbox = bg_draw.textbbox((0, 0), text, font=font)
    tw = t_bbox[2] - t_bbox[0]
    th = t_bbox[3] - t_bbox[1]
    tx = badge_x1 + (badge_w - tw) // 2
    ty = badge_y1 + (badge_h - th) // 2 - int(badge_h * 0.08)
    bg_draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))
    
    # Save master
    bg_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(output_dir, "icon-512.png"))
    
    # Save standard extension sizes
    for s in [16, 32, 48, 128]:
        resized = bg_img.resize((s, s), Image.Resampling.LANCZOS)
        resized.save(os.path.join(output_dir, f"icon-{s}.png"))
        
    print(f"Icons saved to {output_dir}")

if __name__ == "__main__":
    generate_icons()
