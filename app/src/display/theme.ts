export const theme = {
  colors: {
    bg: '#050708',
    bgAlt: '#0A0D0F',
    accent: '#5FD07A',
    text: '#DCE6EA',
    textDim: '#C3CDD2',
    textFaint: '#6A757C',
    textFainter: '#4a545a',
    warn: '#E0B15F',
    alert: '#E0675C',
    ram: '#6FA8D0',
    border: '#1E272C',
    borderDim: '#141b1f',
  },
  font: {
    regular: 'IBMPlexMono-Regular',
    medium: 'IBMPlexMono-Medium',
    semibold: 'IBMPlexMono-SemiBold',
    bold: 'IBMPlexMono-Bold',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radii: { card: 12, pill: 20 },
} as const;
