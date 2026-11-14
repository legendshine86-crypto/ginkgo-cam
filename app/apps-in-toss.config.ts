import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  // 콘솔에 등록한 appName과 똑같아야 업로드돼요
  appName: "now-that-road",
  // '가까운 순'을 고를 때만 위치를 물어봐요
  permissions: [{ name: "geolocation", access: "access" }],
  webView: {
    bounces: true,
    pullToRefreshEnabled: true,
    overScrollMode: "never",
  },
  webBundleDir: "dist",
});
