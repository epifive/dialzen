/** Injects the admin-selected brand colour as the --primary CSS variable. */
export function BrandStyle({ color }: { color: string }) {
  const safe = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#a21caf";
  return <style>{`:root{--primary:${safe}}`}</style>;
}
