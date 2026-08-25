# listen_2gth — Hướng dẫn sử dụng

Trang web phát nhạc YouTube chung cho nhiều người. Mọi người paste link YouTube vào queue, host điều khiển phát nhạc.

## Yêu cầu

- Node.js >= 18
- npm

## Cài đặt

```bash
npm install
```

## Chạy server (host)

```bash
HOST_PASSWORD=mật_khẩu_của_bạn npm start
```

Ví dụ: `HOST_PASSWORD=12345 npm start`

Server chạy ở `http://localhost:3000`. Để mọi người trong cùng mạng LAN cùng nghe, dùng IP máy của bạn (vd `http://192.168.1.10:3000`).

Đổi port (mặc định 3000):

```bash
HOST_PASSWORD=12345 PORT=8080 npm start
```

## Đăng nhập host

1. Mở trang `http://localhost:3000` trong trình duyệt
2. Tìm card "Host" → nhập mật khẩu đã đặt → bấm **Login as host**

Sau khi login, host có thêm:
- Nút **Skip** để chuyển bài
- Nút **Clear queue** để xóa toàn bộ hàng đợi
- Nút **Remove** trên mỗi bài để xóa 1 bài

## Mời mọi người tham gia

Gửi URL trang (vd `http://192.168.1.10:3000`) cho mọi người. Họ mở URL, paste link YouTube vào ô "Paste YouTube link…" → bấm **Add**.

Mọi người sẽ thấy queue đồng bộ real-time. Bài đang phát hiển thị "🔴 Đang phát: <tên bài>".

## Lưu ý

- **Chỉ tab host mới phát ra tiếng.** Các tab khác hiển thị đồng bộ nhưng không có audio (master-client model).
- **Host đóng tab** → các client khác thấy "Host offline". Host mở lại tab và login lại để tiếp tục phát.
- **Queue được lưu vào `data/queue.json`.** Restart server sẽ giữ nguyên queue và bài đang phát.

## Các link YouTube được chấp nhận

- `https://www.youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- `https://www.youtube.com/shorts/ID`

## Chạy tests

```bash
npm test
```