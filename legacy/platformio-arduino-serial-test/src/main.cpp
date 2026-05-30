#include <Arduino.h>

unsigned long counter = 0;

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("ESP32-S3 serial test started");
  Serial.printf("Chip model: %s\n", ESP.getChipModel());
  Serial.printf("CPU frequency: %u MHz\n", ESP.getCpuFreqMHz());
  Serial.printf("Flash size: %u bytes\n", ESP.getFlashChipSize());
  Serial.printf("PSRAM size: %u bytes\n", ESP.getPsramSize());
}

void loop() {
  Serial.printf("Hello from ESP32-S3, tick %lu, uptime %lu ms\n", counter++, millis());
  delay(1000);
}
