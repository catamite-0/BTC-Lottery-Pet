export interface FrontendDiagnosticSection {
  title: string;
  body: string;
  bodyJson?: unknown;
}

export function withParsedFrontendDiagnosticBodyJson(
  section: FrontendDiagnosticSection,
): FrontendDiagnosticSection {
  try {
    return { ...section, bodyJson: JSON.parse(section.body) };
  } catch {
    return section;
  }
}

export function appendFrontendDevLogSection(
  sections: FrontendDiagnosticSection[],
  devLogSnapshot: string | null | undefined,
) {
  if (!devLogSnapshot) {
    return sections;
  }

  return [
    ...sections,
    {
      title: "Frontend DEV LOG",
      body: devLogSnapshot,
    },
  ];
}
