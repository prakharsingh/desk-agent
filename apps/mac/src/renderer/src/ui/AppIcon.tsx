// The app icon as shown in-app (Settings > Overview hero). Same artwork as the
// packaged apps/mac/build/icon.icns: the user's final icon art
// (apps/mac/build/icon-source.png), only scaled onto a rounded tile -- see
// assets/app-icon.png (512 px, tile inset 4/128 like the previous SVG).
import appIconUrl from '../assets/app-icon.png';

export function AppIcon({ size = 34 }: { size?: number }) {
  return (
    <img
      src={appIconUrl}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{ display: 'block', width: size, height: size }}
    />
  );
}
