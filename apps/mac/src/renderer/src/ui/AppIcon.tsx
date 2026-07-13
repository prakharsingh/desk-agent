// Transcribed verbatim from the approved design mockup's appIcon() SVG
// generator (Desk Agent Mac.dc.html) -- a docked-phone silhouette showing a
// presence dot, a bar chart, and a sparkline, on a dark-graphite squircle.
// This exact SVG also becomes the packaged .icns (see apps/mac/build/) so
// the in-app icon, tray/dock icon, and app-switcher icon are all the same
// artwork.
function bar(x: number, y: number, height: number, opacity: number) {
  return <rect key={`b${x}`} x={x} y={y} width={3} height={height} rx={0.8} fill="#3f8a56" opacity={opacity} />;
}

export function AppIcon({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="diBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#272c35" />
          <stop offset="1" stopColor="#0b0d10" />
        </linearGradient>
        <radialGradient id="diSheen" cx="0.5" cy="0.06" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.13} />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="diPhone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a4149" />
          <stop offset="1" stopColor="#20252d" />
        </linearGradient>
        <linearGradient id="diBezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a525c" />
          <stop offset="1" stopColor="#181c22" />
        </linearGradient>
        <linearGradient id="diScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1519" />
          <stop offset="1" stopColor="#080b0e" />
        </linearGradient>
        <linearGradient id="diBase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#454d57" />
          <stop offset="1" stopColor="#2a3038" />
        </linearGradient>
      </defs>
      <rect x={4} y={4} width={120} height={120} rx={28} fill="url(#diBg)" />
      <rect x={4} y={4} width={120} height={120} rx={28} fill="url(#diSheen)" />
      <rect x={4.75} y={4.75} width={118.5} height={118.5} rx={27.3} fill="none" stroke="#ffffff" strokeOpacity={0.13} strokeWidth={1} />
      <ellipse cx={64} cy={106} rx={25} ry={4.2} fill="#000000" opacity={0.5} />
      <rect x={60} y={90} width={8} height={12} fill="#2c323b" />
      <rect x={41} y={99} width={46} height={8} rx={4} fill="url(#diBase)" />
      <rect x={41} y={99} width={46} height={2.4} rx={1.2} fill="#ffffff" opacity={0.14} />
      <rect x={39} y={17} width={50} height={74} rx={13} fill="url(#diBezel)" />
      <rect x={40.5} y={18.5} width={47} height={71} rx={11.5} fill="url(#diPhone)" />
      <rect x={45} y={23} width={38} height={62} rx={7} fill="url(#diScreen)" />
      <circle cx={51} cy={30} r={1.9} fill="#5FD07A" />
      <rect x={55} y={29} width={20} height={2} rx={1} fill="#3f8a56" opacity={0.5} />
      <rect x={48} y={36} width={33} height={19} rx={3} fill="#070a0e" />
      {bar(50.5, 47, 6, 0.55)}
      {bar(55, 44, 9, 0.75)}
      {bar(59.5, 41, 12, 1)}
      {bar(64, 45.5, 7.5, 0.7)}
      {bar(68.5, 42.5, 10.5, 0.9)}
      {bar(73, 48, 5, 0.5)}
      <rect x={48} y={58} width={33} height={17} rx={3} fill="#070a0e" />
      <path d="M50 71 L55 67 L60 69 L65 63 L70 66 L76 62 L79 64 L79 73 L50 73 Z" fill="#3f8a56" fillOpacity={0.14} />
      <polyline points="50,71 55,67 60,69 65,63 70,66 76,62 79,64" fill="none" stroke="#3f8a56" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
