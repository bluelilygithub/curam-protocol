const DEFAULT_PAGES = ['Home', 'About', 'Services', 'Blog', 'Portfolio', 'Contact'];

function normalizeIntakeData(intakeData = {}) {
  const data = { ...intakeData };

  data.structure = {
    pages: DEFAULT_PAGES,
    pageSections: {},
    ...(data.structure || {}),
  };
  if (!data.structure.pages?.length) {
    data.structure.pages = [...DEFAULT_PAGES];
  }

  data.functionality = Array.isArray(data.functionality)
    ? data.functionality.filter(Boolean).map(String)
    : [];

  data.content = {
    copyReady: false,
    imagesReady: false,
    updatedBy: 'Non-technical client',
    ...(data.content || {}),
  };

  return data;
}

module.exports = {
  DEFAULT_PAGES,
  normalizeIntakeData,
};
