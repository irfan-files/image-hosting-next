// config.ts
// Jangan fallback ke localhost; pakai ENV atau relative '' (same-origin via Nginx)
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
// NOTE:
// - Production: set NEXT_PUBLIC_BACKEND_URL="https://uploadimage.xyz"
// - Dev lokal:  set ke "http://localhost:4000" kalau mau bypass Nginx,
//   atau biarkan "" lalu panggil path relatif (proxied via Nginx)
