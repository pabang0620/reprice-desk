import { studioTheme } from 'ag-studio'

// Navy background, mint for "kept", amber for "raised". The same two state colours are used in the light theme.
export const COLORS = { mint: '#3DDC97', amber: '#F5A524', navy: '#0F1B33', navyDeep: '#0A1327', navyRaised: '#16284A', line: '#27406B', text: '#E6EDF7' }

export const darkTheme = studioTheme.withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  backgroundColor: COLORS.navy,
  textColor: COLORS.text,
  borderColor: COLORS.line,
  accentColor: COLORS.mint,
  studioCanvasBackgroundColor: COLORS.navyDeep,
  studioWidgetBackgroundColor: COLORS.navyRaised,
  studioWidgetBorder: [1, COLORS.line],
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 6,
  foregroundColor: COLORS.text,
  gridDataBackgroundColor: COLORS.navyRaised,
  gridOddRowBackgroundColor: '#1a2f57',
  gridHeaderBackgroundColor: COLORS.navy,
})

export const lightTheme = studioTheme.withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  backgroundColor: '#F5F8FC',
  textColor: '#0F1B33',
  borderColor: '#C9D6EA',
  accentColor: '#12A56A',
  studioCanvasBackgroundColor: '#E9F0FA',
  studioWidgetBackgroundColor: '#FFFFFF',
  studioWidgetBorder: [1, '#C9D6EA'],
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 6,
})
