# **Software Requirements Specification (SRS) \- FluxNode**

## **1\. บทนำ (Introduction)**

FluxNode คือแพลตฟอร์มตัดต่อวิดีโอระดับมืออาชีพที่ผสานพลังของการตัดต่อเชิงเส้น (Timeline) และการสร้างสรรค์ด้วย Node-based Workflow เพื่อให้ผู้ใช้สามารถควบคุมทั้งกระบวนการตัดต่อแบบดั้งเดิมและงานที่ต้องพึ่งพาการประมวลผล AI/Shaders ได้ในที่เดียว

## **2\. ขอบเขตของระบบ (System Scope)**

ระบบแบ่งออกเป็น 2 โหมดหลัก:

* **Timeline View:** สำหรับการตัดต่อวิดีโอ, การวาง Keyframes, และการจัดการเลเยอร์วิดีโอ/เสียง  
* **Workflow View:** ระบบ Node-based สำหรับการเชื่อมต่อ Data Pipeline (Media Source → Camera → Shader → Compositor → Output)

## **3\. ความต้องการด้านฟังก์ชัน (Functional Requirements)**

### **3.1 การสลับโหมดการทำงาน (View Switching)**

* ระบบต้องมีปุ่มสลับ (Switcher) ที่ด้านบนของ UI เพื่อเปลี่ยนโหมดระหว่าง Timeline และ Workflow ได้ทันที  
* สถานะการทำงาน (State) ของโปรเจกต์ต้องถูกคงไว้เมื่อสลับโหมด

### **3.2 ระบบ Node-based Workflow**

* **Node System:** รองรับการเชื่อมต่อ Node ประเภทต่างๆ (Media Source, Camera, Shader, Compositor)  
* **Dynamic Data Pipeline:** ผู้ใช้สามารถลากเส้นเชื่อมต่อข้อมูลระหว่าง Node เพื่อปรับเปลี่ยนลำดับการประมวลผล  
* **Compute Source Selection:** ผู้ใช้สามารถเลือกโหมดการประมวลผลได้:  
  * **Local (Comfy):** ประมวลผลบนเครื่องผ่านระบบ ComfyUI  
  * **Cloud (API):** ประมวลผลผ่านเซิร์ฟเวอร์คลาวด์เพื่อประสิทธิภาพที่สูงขึ้น

### **3.3 การจัดการ Timeline และ Media**

* ระบบต้องรองรับการ Import วิดีโอและแสดงผลบน Track  
* Timeline ต้องซิงค์ข้อมูลกับ Node "Media Source" ใน Workflow View  
* รองรับการควบคุมพื้นฐาน เช่น Play, Pause, Seek, และการปรับแต่ง Transform

### **3.4 ระบบ Render & Output**

* ต้องแสดงผลลัพธ์วิดีโอ (Preview) แบบ Real-time ในโหมด Workflow  
* รองรับการ Queue งานเพื่อประมวลผลภายหลัง

## **4\. ความต้องการด้านประสิทธิภาพ (Performance Requirements)**

* **Latency:** การสลับโหมดการทำงานต้องใช้เวลาน้อยกว่า 500 มิลลิวินาที  
* **Node Rendering:** ระบบ Workflow ต้องรองรับการแพนและซูมบนพื้นที่ขนาดใหญ่ (Canvas) โดยไม่กระตุก (Smooth panning/zooming)  
* **Concurrency:** ระบบต้องรองรับการประมวลผลคลาวด์แบบขนาน (Async API Calls) โดยไม่มีการหยุดชะงักของ UI

## **5\. ความต้องการด้าน UI/UX (UI/UX Requirements)**

* **Theme:** ใช้ Dark Mode เป็นหลัก (พื้นหลัง \#0d0d0d) เพื่อถนอมสายตาสำหรับงานตัดต่อ  
* **Interaction:** \* Workflow View: รองรับการลากวาง (Drag-and-drop) Node และเส้นเชื่อมต่อ  
  * Timeline View: รองรับการลากปรับเวลาและการใช้ Playhead  
* **Responsive:** UI ต้องปรับขนาดตามความละเอียดหน้าจอโดยไม่ทำให้ส่วนประกอบหลักเสียสัดส่วน

## **6\. ข้อกำหนดด้านความปลอดภัย (Security Requirements)**

* การเชื่อมต่อกับ Local (Comfy) ต้องมีระบบ Authentication ภายในเครือข่าย  
* การเชื่อมต่อ Cloud (API) ต้องใช้ Token-based Authentication เพื่อความปลอดภัยของข้อมูล