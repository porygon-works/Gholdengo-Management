// アプリの版。vite.config.ts でビルドのときに埋めこむ（package.json の version・コミット・ビルドした日時）
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILT = __APP_BUILT__;
export const VERSION_LABEL = `Ver ${APP_VERSION}（${APP_COMMIT}・${APP_BUILT}）`;
