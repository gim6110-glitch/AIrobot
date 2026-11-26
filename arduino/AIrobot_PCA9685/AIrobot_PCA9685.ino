/*
 * AIrobot | Arduino UNO R3 + PCA9685 (I2C) | 115200 baud
 * Dependencies: Adafruit PWM Servo Driver Library (+ Adafruit BusIO)
 *
 * IMPORTANT: set EACH axis pulse and angle limits from your own hardware measurements.
 * A software STOP de-energizes servo PWM; it is NOT an emergency power disconnect.
 * A robot arm may drop under gravity after STOP. Provide physical support and power cutoff.
 * Remove the robot's payload during calibration. Disconnect motor V+ when uploading sketches.
 */
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver driver(0x40);
constexpr uint8_t AXES = 4;
const uint8_t CHANNELS[AXES] = {0, 1, 2, 3}; // base, shoulder, elbow, gripper
const uint16_t MIN_US[AXES] = {650, 650, 650, 700};   // TUNE PER SERVO
const uint16_t MAX_US[AXES] = {2350, 2350, 2350, 2300}; // TUNE PER SERVO
const uint8_t MIN_DEG[AXES] = {20, 30, 30, 25};   // conservative examples; TUNE
const uint8_t MAX_DEG[AXES] = {160, 150, 150, 150}; // conservative examples; TUNE
const bool REVERSE[AXES] = {false, false, false, false}; // TUNE
const uint8_t BOOT_DEG[AXES] = {90, 90, 90, 90}; // should be safe supported posture
const unsigned long STEP_MS = 25;
const unsigned long WATCHDOG_MS = 3500;
const uint8_t STEP_DEG = 1; // slow controlled motion, 1 degree per 25ms

int currentDeg[AXES] = {90,90,90,90};
int targetDeg[AXES] = {90,90,90,90};
bool armed = false;
bool moving = false;
bool pwmEnabled = false;
bool stopLatched = false;
int activeAxis = -1; // -1: all axes, 0..3: diagnostics of a single servo
unsigned long lastStep = 0, lastContact = 0;
char lineBuffer[90];
uint8_t lineLength = 0;

uint16_t pulseCounts(uint8_t index, int degree) {
  degree = constrain(degree, 0, 180);
  if (REVERSE[index]) degree = 180 - degree;
  long us = map(degree, 0, 180, MIN_US[index], MAX_US[index]);
  // 50Hz = 20,000us period; PCA9685 divides into 4096 ticks.
  return (uint16_t)constrain((us * 4096L) / 20000L, 0L, 4095L);
}

void disableOutput() {
  for (uint8_t i = 0; i < AXES; ++i) driver.setPWM(CHANNELS[i], 0, 4096);
  pwmEnabled = false;
  moving = false;
  activeAxis = -1;
}
void printAngles() {
  Serial.print(F("STATUS,"));
  Serial.print(armed ? 1 : 0);
  Serial.print(',');
  Serial.print(moving ? 1 : 0);
  for (uint8_t i=0;i<AXES;i++){ Serial.print(',');Serial.print(currentDeg[i]);}
  Serial.println();
}
void stopOutput(bool latchStop) {
  disableOutput();
  armed = false;
  stopLatched = latchStop;
}
void sendError(const __FlashStringHelper* msg) {
  Serial.print(F("ERR "));
  Serial.println(msg);
}
bool parsePose(const char* s, int out[4]) {
  // Exactly four comma-separated integer values, no trailing bytes allowed.
  for (int i=0;i<AXES;i++){
    if (!*s) return false;
    char* end;
    long value = strtol(s, &end, 10);
    if (end == s || value < 0 || value > 180) return false;
    if (i<AXES-1 && *end!=',') return false;
    if (i==AXES-1 && *end!='\0') return false;
    out[i]=(int)value;
    s=end+(i<AXES-1?1:0);
  }
  return true;
}
bool parseAxis(const char* s, int& axis, int& angle) {
  if(!s || !*s) return false;
  char* end;
  long index=strtol(s,&end,10);
  if(end==s || *end!=',' || index<0 || index>=AXES) return false;
  char* next;
  long requested=strtol(end+1,&next,10);
  if(next==end+1 || *next!='\0' || requested<0 || requested>180) return false;
  axis=(int)index;
  angle=(int)requested;
  return true;
}
void processLine(char* line) {
  lastContact = millis();
  if (!strcmp(line,"HELLO")) { Serial.println(F("READY AIROBOT/1")); return; }
  if (!strcmp(line,"PING")) { Serial.println(F("PONG")); return; }
  if (!strcmp(line,"STATUS")) { printAngles(); return; }
  if (!strcmp(line,"STOP")) { stopOutput(true); Serial.println(F("STOPPED")); return; }
  if (!strcmp(line,"DISARM")) { stopOutput(false); Serial.println(F("DISARMED")); return; }
  if (!strcmp(line,"ARM")) {
    if (stopLatched) { sendError(F("STOP_LATCHED: send DISARM then ARM")); return; }
    armed=true;
    // No PWM until a deliberate, validated POSE command.
    Serial.println(F("ARMED"));
    return;
  }
  if (!strncmp(line,"AXIS,",5)) {
    if (!armed || stopLatched) { sendError(F("DISARMED")); return; }
    if (moving) { sendError(F("BUSY")); return; }
    int axis=-1, angle=-1;
    if (!parseAxis(line+5,axis,angle)) { sendError(F("BAD_AXIS")); return; }
    if (angle<MIN_DEG[axis] || angle>MAX_DEG[axis]) { sendError(F("LIMIT")); return; }
    targetDeg[axis]=angle;
    activeAxis=axis;
    moving=true;
    // Only the selected channel is written; initial activation may cause a
    // sudden jump toward BOOT_DEG. Mechanically support the arm first.
    Serial.println(F("ACK AXIS"));
    return;
  }
  if (!strncmp(line,"POSE,",5)) {
    if (!armed || stopLatched) { sendError(F("DISARMED")); return; }
    if (moving) { sendError(F("BUSY")); return; }
    int values[4];
    if (!parsePose(line+5,values)) { sendError(F("BAD_POSE")); return; }
    for (int i=0;i<4;i++){
      if (values[i]<MIN_DEG[i] || values[i]>MAX_DEG[i]) {
        sendError(F("LIMIT")); return;
      }
    }
    for (int i=0;i<4;i++) targetDeg[i]=values[i];
    pwmEnabled=true;
    activeAxis=-1;
    moving=true;
    Serial.println(F("ACK POSE"));
    return;
  }
  sendError(F("UNKNOWN"));
}
void setup() {
  Serial.begin(115200);
  Wire.begin();
  driver.begin();
  driver.setPWMFreq(50);
  disableOutput();
  for (int i=0;i<4;i++) currentDeg[i]=targetDeg[i]=BOOT_DEG[i];
  lastContact=millis();
  delay(60);
  Serial.println(F("READY AIROBOT/1"));
}
void loop() {
  while (Serial.available() > 0) {
    char ch=(char)Serial.read();
    if (ch=='\n') {
      lineBuffer[lineLength]='\0';
      if (lineLength && lineBuffer[lineLength-1]=='\r') lineBuffer[lineLength-1]='\0';
      processLine(lineBuffer);
      lineLength=0;
    } else if (lineLength+1<sizeof(lineBuffer) && ch>=32 && ch<=126) {
      lineBuffer[lineLength++]=ch;
    } else if (ch!='\r') {
      lineLength=0;
      sendError(F("LINE"));
    }
  }
  unsigned long now=millis();
  if (armed && (now-lastContact > WATCHDOG_MS)) {
    stopOutput(true);
    Serial.println(F("STOPPED WATCHDOG"));
  }
  if (moving && now-lastStep>=STEP_MS) {
    lastStep=now;
    bool reached=true;
    for (int i=0;i<4;i++) {
      if (activeAxis>=0 && i!=activeAxis) continue;
      if (currentDeg[i]!=targetDeg[i]) {
        reached=false;
        currentDeg[i]+= targetDeg[i]>currentDeg[i] ? min((int)STEP_DEG, targetDeg[i]-currentDeg[i]) :
                    -min((int)STEP_DEG,currentDeg[i]-targetDeg[i]);
      }
      driver.setPWM(CHANNELS[i],0,pulseCounts(i,currentDeg[i]));
    }
    if (reached) {
      moving=false;
      if(activeAxis>=0) Serial.println(F("DONE AXIS"));
      else Serial.println(F("DONE POSE"));
      activeAxis=-1;
    }
  }
}