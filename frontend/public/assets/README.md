# White-Labeling Guide — AeroNet OS

## Files to Replace

| File | Purpose |
|---|---|
| `logo.svg` | Main brand logo displayed in the header and login screen |
| `favicon.ico` | Browser tab icon |

## Logo Requirements

- **Format:** SVG preferred for crisp rendering at all sizes. PNG accepted as fallback.
- **Minimum dimensions:** 200 x 200 px (if raster).
- **Aspect ratio:** Square or landscape (max 4:1). Tall/portrait logos may clip in the header.
- **Background:** Transparent background recommended — the app uses a dark surface color.

## Updating Brand Name and Colors

Edit `frontend/src/theme/theme.json`:

```json
{
  "brand": {
    "name": "Your Airport Name",
    "logo_path": "/assets/logo.svg",
    "favicon_path": "/assets/favicon.ico"
  },
  "colors": {
    "--color-primary":        "#YOUR_HEX",
    "--color-secondary":      "#YOUR_HEX",
    "--color-background":     "#YOUR_HEX",
    "--color-surface":        "#YOUR_HEX",
    "--color-text-primary":   "#YOUR_HEX",
    "--color-text-secondary": "#YOUR_HEX",
    "--color-alert-critical": "#EF4444",
    "--color-alert-warning":  "#F59E0B",
    "--color-alert-info":     "#3B82F6"
  },
  "fonts": {
    "--font-primary": "'YourFont', sans-serif"
  }
}
```

- `brand.name` — sets the browser tab title and header text.
- `colors` — each key maps to a CSS variable injected at runtime. All Tailwind utility classes (`bg-primary`, `text-secondary`, etc.) reference these variables.
- `fonts` — provide any Google Font or self-hosted font family. Make sure the font is loaded via `<link>` in `index.html` or imported in CSS.

## Rebuilding After Changes

After updating assets or `theme.json`, rebuild the frontend container:

```bash
cd infra
docker compose build frontend
docker compose up -d frontend
```

If using the dev override (hot reload), changes to `theme.json` will take effect on the next page refresh without rebuilding.
