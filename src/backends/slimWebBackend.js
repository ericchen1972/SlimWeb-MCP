export const SLIMWEB_BACKEND_METHODS = Object.freeze([
  'listSitesForAdminIdentity',
  'resolveAdminSiteForIdentity',
  'selectSiteForAdminIdentity',
  'getBasicSettings',
  'updateBasicSettings',
  'listCategories',
  'upsertCategory',
  'deleteCategory',
  'listNavItems',
  'upsertNavItem',
  'deleteNavItem',
  'listProducts',
  'getProduct',
  'prepareProductImageReference',
  'upsertProduct',
  'deleteProduct',
  'inspectProductImport',
  'validateProductImport',
  'commitProductImport',
  'listArticles',
  'checkArticleTitle',
  'getArticleContent',
  'createArticle',
  'updateArticle',
  'deleteArticle',
  'listPages',
  'checkPageTitle',
  'getPageContent',
  'createPage',
  'updatePage',
  'getPagePreviewUrl',
  'deletePage',
  'createUpload',
  'commitUpload',
  'listThemes',
  'getSiteThemeMode',
  'getDesignContext',
  'updateSiteThemeMode',
  'createThemeFromDefault',
  'activateTheme',
  'deleteTheme',
  'getThemeShellContext',
  'updateThemeRootElements',
  'getThemeStyleProfile',
  'upsertThemeStyleProfile',
  'appendThemeStyleProfileRequest',
  'getMediaLibraryStats',
  'deleteUnusedMedia',
  'registerAsset',
  'listExternalAssets',
  'deleteExternalAsset',
  'updateContentSeo',
  'importChatGptAttachment'
]);

export function assertSlimWebBackend(backend) {
  for (const method of SLIMWEB_BACKEND_METHODS) {
    if (typeof backend?.[method] !== 'function') {
      throw new TypeError(`SlimWebBackend is missing ${method}().`);
    }
  }

  return backend;
}
