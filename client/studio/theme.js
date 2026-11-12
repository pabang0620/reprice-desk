import { studioTheme } from 'ag-studio'

// Navy Desk Refined: navy surfaces, mint for "kept", amber for "raised". The same values as client/styles.css.
export const COLORS = { mint: '#3DDC97', amber: '#F5A524', navy: '#0F1B33', navyDeep: '#0A1327', navyRaised: '#142645', line: '#27406B', text: '#E6EDF7' }

export const darkTheme = studioTheme.withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  headerFontWeight: 600,
  backgroundColor: COLORS.navy,
  textColor: COLORS.text,
  borderColor: COLORS.line,
  accentColor: COLORS.mint,
  studioCanvasBackgroundColor: COLORS.navyDeep,
  studioWidgetBackgroundColor: COLORS.navyRaised,
  studioWidgetBorder: [1, COLORS.line],
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 8,
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 650,
  foregroundColor: COLORS.text,
  gridDataBackgroundColor: COLORS.navyRaised,
  gridOddRowBackgroundColor: '#18304F',
  gridHeaderBackgroundColor: COLORS.navy,
})

export const lightTheme = studioTheme.withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  headerFontWeight: 600,
  backgroundColor: '#F5F8FC',
  textColor: '#0F1B33',
  borderColor: '#C9D6EA',
  accentColor: '#0B7D52',
  studioCanvasBackgroundColor: '#E9F0FA',
  studioWidgetBackgroundColor: '#FFFFFF',
  studioWidgetBorder: [1, '#C9D6EA'],
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 8,
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 650,
})
