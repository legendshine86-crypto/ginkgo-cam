// 은행나무 명소 후보를 capture/spots.json에 더한다 (이미 있는 id는 건너뜀). 좌표는 tools/geocode.mjs로 채워요
import { readFileSync, writeFileSync } from "node:fs";
const file = new URL("../capture/spots.json", import.meta.url);
const spots = JSON.parse(readFileSync(file, "utf8"));
const add = [
  // 서울
  ["seoul-munmyo", "서울 성균관 문묘 은행나무", "capital", "서울 종로", "서울", ["성균관 문묘", "성균관"]],
  ["seoul-deoksugung", "서울 덕수궁 돌담길", "capital", "서울 중구", "서울", ["덕수궁"]],
  ["seoul-samcheong", "서울 삼청동 은행나무길", "capital", "서울 종로", "서울", ["삼청동"]],
  ["seoul-hyoja", "서울 경복궁 효자로", "capital", "서울 종로", "서울", ["효자로", "경복궁"]],
  ["seoul-forest", "서울숲 은행나무숲", "capital", "서울 성동", "서울", ["서울숲"]],
  ["seoul-yangjae", "서울 양재시민의숲", "capital", "서울 서초", "서울", ["양재시민의숲", "시민의숲"]],
  ["seoul-wiryeseong", "서울 위례성대로 은행나무길", "capital", "서울 송파", "서울", ["위례성대로"]],
  ["seoul-olympic", "서울 올림픽공원", "capital", "서울 송파", "서울", ["올림픽공원"]],
  ["seoul-hwarangdae", "서울 화랑대철도공원", "capital", "서울 노원", "서울", ["화랑대철도공원", "화랑대역"]],
  ["seoul-banghak", "서울 방학동 은행나무", "capital", "서울 도봉", "서울", ["방학동 은행나무", "방학동"]],
  ["seoul-changgyeong", "서울 창경궁 은행나무", "capital", "서울 종로", "서울", ["창경궁"]],
  ["seoul-namsan", "서울 남산 북측순환로", "capital", "서울 중구", "서울", ["남산공원", "남산"]],
  // 부산
  ["busan-beomeo", "부산 범어사 은행나무", "gyeongsang", "부산 금정", "부산", ["범어사"]],
  // 수도권
  ["yangpyeong-yongmun", "양평 용문사 은행나무", "capital", "경기 양평", "양평", ["용문사 양평", "용문산관광지"]],
  ["gwacheon-ginkgo", "과천 은행나무길", "capital", "경기 과천", "과천", ["정부과천청사", "과천시 중앙동"]],
  ["incheon-grandpark", "인천대공원 은행나무길", "capital", "인천 남동", "인천", ["인천대공원"]],
  ["hwaseong-yunggeon", "화성 융건릉 은행나무", "capital", "경기 화성", "화성", ["융건릉"]],
  ["suwon-hwaseong", "수원 화성 은행나무", "capital", "경기 수원", "수원", ["수원 화성행궁", "화성행궁"]],
  // 강원
  ["yeongwol-hasong", "영월 하송리 은행나무", "gangwon", "강원 영월", "영월", ["하송리 영월", "영월읍"]],
  ["hongcheon-forest", "홍천 은행나무숲", "gangwon", "강원 홍천", "홍천", ["홍천 은행나무숲", "광원리 홍천"]],
  ["chuncheon-nami", "춘천 남이섬 은행나무길", "gangwon", "강원 춘천", "춘천", ["남이섬"]],
  ["chuncheon-soyang", "춘천 공지천 은행나무길", "gangwon", "강원 춘천", "춘천", ["공지천 춘천", "공지천"]],
  ["gangneung-ojukheon", "강릉 오죽헌 은행나무", "gangwon", "강원 강릉", "강릉", ["오죽헌"]],
  // 충청
  ["boryeong-cheongna", "보령 청라은행마을", "chungcheong", "충남 보령", "보령", ["장현리 보령", "청라면"]],
  ["dangjin-myeoncheon", "당진 면천 은행나무", "chungcheong", "충남 당진", "당진", ["면천읍성", "면천면"]],
  ["goesan-mungwang", "괴산 문광저수지 은행나무길", "chungcheong", "충북 괴산", "괴산", ["문광저수지"]],
  ["geumsan-yogwang", "금산 요광리 은행나무", "chungcheong", "충남 금산", "금산", ["요광리 금산", "추부면"]],
  ["geumsan-boseok", "금산 보석사 은행나무", "chungcheong", "충남 금산", "금산", ["보석사 금산", "보석사"]],
  ["cheongju-nangseong", "청주 낭성 은행나무길", "chungcheong", "충북 청주", "청주", ["지산리 청주", "낭성면"]],
  ["yeongdong-yeongguk", "영동 영국사 은행나무", "chungcheong", "충북 영동", "영동", ["영국사 영동", "영국사"]],
  ["buyeo-juam", "부여 주암리 은행나무", "chungcheong", "충남 부여", "부여", ["주암리 부여"]],
  ["sejong-imnansu", "세종 임난수 은행나무", "chungcheong", "세종", "세종", ["세종리 세종", "연기면"]],
  ["cheongyang-bongam", "청양 봉암리 은행나무", "chungcheong", "충남 청양", "청양", ["봉암리 청양"]],
  // 경상
  ["yeongju-sosu", "영주 소수서원 은행나무", "gyeongsang", "경북 영주", "영주", ["소수서원"]],
  ["yeongju-buseok", "영주 부석사 은행나무길", "gyeongsang", "경북 영주", "영주", ["부석사 영주", "부석사"]],
  ["uiryeong-segan", "의령 세간리 은행나무", "gyeongsang", "경남 의령", "의령", ["세간리 의령", "유곡면"]],
  ["hamyang-ungok", "함양 운곡리 은행나무", "gyeongsang", "경남 함양", "함양", ["운곡리 함양", "서하면"]],
  ["sangju-dugok", "상주 두곡리 은행나무", "gyeongsang", "경북 상주", "상주", ["두곡리", "은척면"]],
  ["daegu-palgong", "대구 팔공산 은행나무길", "gyeongsang", "대구 동구", "대구", ["동화사", "백안삼거리"]],
  ["goryeong-dasan", "고령 다산 은행나무숲", "gyeongsang", "경북 고령", "고령", ["좌학리 고령", "다산면 고령"]],
  ["gyeongju-tongil", "경주 통일전 은행나무길", "gyeongsang", "경북 경주", "경주", ["통일전"]],
  // 전라
  ["jeonju-hyanggyo", "전주향교 은행나무", "jeolla", "전북 전주", "전주", ["전주향교"]],
  ["naju-geumseong", "나주 금성관 은행나무", "jeolla", "전남 나주", "나주", ["금성관 나주", "나주목"]],
  ["gangjin-byeongyeong", "강진 병영 은행나무", "jeolla", "전남 강진", "강진", ["성동리 강진", "병영면"]],
  ["boseong-beolgyo", "보성 벌교 은행나무", "jeolla", "전남 보성", "보성", ["벌교읍"]],
  ["imsil-ginkgo", "임실 은행나무", "jeolla", "전북 임실", "임실", ["임실읍"]],
];
let n = 0;
for (const [id, name, area, region, city, geo] of add) {
  if (spots.some(s => s.id === id || s.name === name)) continue;
  spots.push({ id, name, kind: "ginkgo", area, region, city, geo });
  n++;
}
writeFileSync(file, JSON.stringify(spots, null, 2) + "\n", "utf8");
console.log(`${n}곳을 더했어요. 지금 ${spots.length}곳`);
