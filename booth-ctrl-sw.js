/* 부스 운영자 화면(/booth-ctrl) 시스템 알림 전용 Service Worker.
   · 범위는 /booth-ctrl 뿐입니다(관람객 화면 · /example 은 이 워커 밖).
   · fetch 를 가로채지 않고 아무것도 캐시하지 않습니다 — 화면 · 정적 파일은 지금처럼 네트워크에서 받습니다.
   · 알림 내용은 알림 번호(n)와 만료 시각(e)뿐입니다. 문구는 늘 같고, 무엇을 할지는 화면이 서버에서 다시 읽어 정합니다.
   · 운영자 화면이 보이고 있으면 시스템 알림 대신 화면에 ‘지금 다시 읽기’ 만 알립니다(화면 안 카드가 뜸).
   · 누르면 열려 있는 운영자 화면으로 가고, 없으면 /booth-ctrl?nt=번호 를 엽니다(QR 열쇠 · PIN 세션은 그 기기 화면이 가진 것만). */
var TITLE = '운영본부 알림';
var BODY = '다시 확인해 주세요.';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function ctrlClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    return list.filter(function (c) {
      try { return new URL(c.url).pathname.indexOf('/booth-ctrl') === 0; } catch (x) { return false; }
    });
  });
}

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  var n = Number(d.n) || 0, exp = Number(d.e) || 0;
  e.waitUntil(ctrlClients().then(function (list) {
    list.forEach(function (c) { c.postMessage({ type: 'aisw-notice', n: n }); });
    if (exp && Date.now() > exp + 60000) return null;                       // 만료된 알림은 다시 띄우지 않음
    if (list.some(function (c) { return c.visibilityState === 'visible'; })) return null;   // 화면이 보이면 화면 안 카드로
    return self.registration.showNotification(TITLE, {
      body: BODY, tag: 'aisw-notice-' + n, renotify: false, requireInteraction: true, data: { n: n }
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  var n = (e.notification.data && Number(e.notification.data.n)) || 0;
  e.notification.close();
  e.waitUntil(ctrlClients().then(function (list) {
    var c = list.filter(function (x) { return x.visibilityState === 'visible'; })[0] || list[0];
    if (c) {
      c.postMessage({ type: 'aisw-notice', n: n, open: true });
      return c.focus();
    }
    return self.clients.openWindow('/booth-ctrl?nt=' + n);
  }));
});
