// Mạch đếm xung cho máy nhận tiền giấy (ICT A7 / V7 ở chế độ PULSE) → máy chụp photobooth.
// Arduino Pro Micro (ATmega32U4; Nano / Uno / ESP32 cũng được) cắm USB vào máy tính của máy chụp;
// trang máy chụp đọc qua cổng COM (Cài đặt máy chụp → Máy nhận tiền → "Xung qua Arduino (COM)").
// Pro Micro: chân ngắt dùng được 0, 1, 2, 3, 7 — dùng chân 2 như dưới.
//
// Đấu dây (kiểm tra lại sơ đồ chân trong tài liệu model đã mua):
//   Máy nhận tiền 12V DC (nguồn ≥ 2A, xem tem máy: có bản 24V / AC) lấy nguồn riêng;
//   GND của nguồn 12V nối chung GND Arduino. KHÔNG nối 12V vào Arduino.
//   Chân PULSE (xung ra, cực thu hở) → chân D2 Arduino (dùng điện trở kéo lên nội).
//   Chân INHIBIT (cấm nhận tiền)    → chân D4 Arduino (qua transistor / opto nếu máy cần 12V).
//
// Trên máy nhận tiền: DIP switch chọn chế độ Pulse (không dùng RS232 / MDB), mỗi xung =
// PULSE_VALUE đồng (vd. 10.000 đ: tờ 10k = 1 xung, 20k = 2 xung, 50k = 5 xung). Máy phải có
// firmware tiền Việt (polymer). Máy chụp gửi "ENABLE" / "DISABLE"; mạch gửi "BILL <số tiền>" khi nhận
// xong một tờ, "READY" khi khởi động.

const byte PULSE_PIN = 2;
const byte INHIBIT_PIN = 4;
const long PULSE_VALUE = 10000;       // số tiền mỗi xung (đồng)
const unsigned long BILL_GAP_MS = 400; // không có xung mới quá khoảng này = xong một tờ
const bool INHIBIT_ACTIVE_HIGH = true; // mức điện để CẤM nhận tiền (xem tài liệu máy)

volatile unsigned int pulses = 0;
volatile unsigned long lastPulse = 0;
String line;

void onPulse() {
  unsigned long now = millis();
  // Bỏ nhiễu dội tiếp điểm (xung thật dài ~50 ms, cách nhau ~50–100 ms).
  if (now - lastPulse > 20) {
    pulses++;
    lastPulse = now;
  }
}

void setInhibit(bool inhibit) {
  digitalWrite(INHIBIT_PIN, inhibit == INHIBIT_ACTIVE_HIGH ? HIGH : LOW);
}

void setup() {
  Serial.begin(9600);
  pinMode(PULSE_PIN, INPUT_PULLUP);
  pinMode(INHIBIT_PIN, OUTPUT);
  setInhibit(true); // mặc định không nhận tiền cho tới khi máy chụp gửi ENABLE
  attachInterrupt(digitalPinToInterrupt(PULSE_PIN), onPulse, FALLING);
  Serial.println("READY");
}

void loop() {
  noInterrupts();
  unsigned int count = pulses;
  unsigned long last = lastPulse;
  interrupts();
  if (count > 0 && millis() - last > BILL_GAP_MS) {
    noInterrupts();
    pulses = 0;
    interrupts();
    Serial.print("BILL ");
    Serial.println((long)count * PULSE_VALUE);
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line == "ENABLE") setInhibit(false);
      else if (line == "DISABLE") setInhibit(true);
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }
}
