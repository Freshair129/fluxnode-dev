# **Product Requirements Document (PRD) \- FluxNode**

## **1\. วิสัยทัศน์ของผลิตภัณฑ์ (Product Vision)**

FluxNode คือเครื่องมือตัดต่อวิดีโอระดับ AI-Native แห่งอนาคตที่ทำลายขอบเขตระหว่างการตัดต่อแบบดั้งเดิม (Timeline-based) และการผลิตงานสร้างสรรค์ด้วย AI/Visual Effects (Node-based) มอบประสบการณ์ที่ลื่นไหลให้ Creator ทำงานได้ทั้งงานตัดต่อทั่วไปและงานสร้าง Pipeline ขั้นสูงในที่เดียว

## **2\. กลุ่มเป้าหมาย (Target Audience)**

* **Video Creators:** ผู้ที่ต้องการงานคุณภาพสูงด้วยเวลาที่รวดเร็ว  
* **Visual Effects Artists:** ผู้ที่ต้องการความยืดหยุ่นในการทำ Pipeline แบบ Node-based  
* **Creative Technologists:** ผู้ที่สนใจการนำ AI และ Shader มาประยุกต์ใช้ในวิดีโอ

## **3\. ฟีเจอร์หลัก (Key Features)**

### **3.1 Dual-View Interface**

* **Timeline Mode:** อินเทอร์เฟซตัดต่อวิดีโอแบบลากวางพร้อมระบบจัดการ Keyframe เพื่อการตัดต่อที่แม่นยำ  
* **Workflow Mode:** อินเทอร์เฟซแบบ Node-based Canvas สำหรับเชื่อมต่อ Pipeline (Media Source → Camera → Shader → Compositor → Output)  
* **Global View Switcher:** ปุ่มสลับหน้าจอ (Switcher) ที่ด้านบนของ UI ให้ผู้ใช้สลับระหว่าง Timeline และ Workflow ได้ทันที (Latency \< 500ms)

### **3.2 Hybrid Compute Pipeline**

* **Local Processing (Comfy):** การใช้พลังประมวลผลบนเครื่อง (Local ComfyUI) เพื่อความเป็นส่วนตัวและความรวดเร็วในงานที่ต้องการ Control สูง  
* **Cloud Processing (API):** การส่งงานประมวลผลผ่านระบบ Cloud API สำหรับงานหนักหรือโครงการขนาดใหญ่  
* **Compute Source Toggle:** ระบบเลือกโหมดการคำนวณ (Local/Cloud) ในหน้า Workflow ช่วยให้สลับได้แบบ Real-time  
* **Seamless Sync:** ข้อมูลจาก Timeline (Media Source) และสถานะของ Node ถูกเชื่อมโยงเข้าด้วยกันโดยอัตโนมัติ

### **3.3 Node Library**

* **Media Source Node:** เชื่อมต่อกับไฟล์วิดีโอ/เสียงในโปรเจกต์  
* **Camera/Shader Node:** ปรับแต่งค่า Camera (Ortho/Persp) และ Fragment Shader  
* **Effects Compositor:** จุดรวมองค์ประกอบแสง สี เอฟเฟกต์ เพื่อสรุปเป็น Video Output

## **4\. แผนงานการพัฒนา (Roadmap)**

### **Phase 1: MVP (Core Foundation)**

* พัฒนา UI พื้นฐาน (Timeline & Canvas)  
* ระบบพื้นฐานการสลับหน้าจอ (View Switching)  
* เชื่อมต่อ Cloud API สำหรับประมวลผลพื้นฐาน

### **Phase 2: Workflow Expansion**

* พัฒนา Node ลากวางและเส้นเชื่อมต่อ (SVG-based)  
* เชื่อมต่อ Local ComfyUI API  
* ระบบ Preview แบบ Real-time ในหน้า Workflow

### **Phase 3: Pro & Sharing**

* ระบบ Authentication และการแชร์ Workspace  
* ระบบ Queue Render งานขนาดใหญ่  
* การรองรับประสิทธิภาพสูงสุด (4K/60fps)

## **5\. ตัวชี้วัดความสำเร็จ (Success Metrics)**

* **User Engagement:** ระยะเวลาที่ผู้ใช้งานอยู่ในระบบต่อเซสชัน  
* **Adoption Rate:** สัดส่วนการใช้งานสลับไปมาระหว่าง Timeline และ Workflow  
* **Performance:** อัตราความสำเร็จในการประมวลผลผ่าน Cloud API และความเสถียรของ Local Pipeline