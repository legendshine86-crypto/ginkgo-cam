# ginkgo-cam

은행나무·벚꽃 명소 근처 공개 교통 카메라 화면을 몇 분마다 찍어 GitHub Pages로 제공해요.

- `capture/spots.json`: 명소와, 그 명소 대신 보여줄 근처 카메라 이름
- `capture/capture.mjs`: 화면을 찍어 `out/`에 저장 (GitHub Actions가 실행)
- 결과: `https://<계정>.github.io/ginkgo-cam/spots.json`, `snap/<id>.jpg`, `thumb/<id>.jpg`

출처: 국가교통정보센터(ITS) 교통 CCTV. 카메라 주소에는 API 키가 들어 있어서 공개 파일에는 암호화(`cams.enc`)해서만 둬요.

필요한 저장소 비밀값: `ITS_KEY`, `ENC_KEY`
