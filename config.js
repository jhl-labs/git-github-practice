// 대시보드 설정 — 이 파일은 공개 웹에 그대로 노출됩니다!
// passwordSha256 은 비밀번호 자체가 아니라 SHA-256 "해시"지만, 짧은 비밀번호는 금방 역산됩니다.
// (튜터 사이트의 "한계와 다음 단계" 장에서 직접 깨 보세요)
window.DASHBOARD_CONFIG = {
  title: '상반기 매출 대시보드',
  // 기본 비밀번호: gitpages2026 → 반드시 튜터 사이트의 해시 생성기로 바꿔 쓰세요.
  passwordSha256: 'e889aea099222ee8301e20d92dea73b3fc708b4ff388775e20e4b830a1e3880b',
  dataUrl: 'data/data.json',
  sessionKey: 'dashboard-auth',
};
