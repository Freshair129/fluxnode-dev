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

### **3.5 ระบบ AI Copilot (AI Copilot Layer)**

* **Action Registry:** ความสามารถทุกอย่างของโปรแกรมตัดต่อต้องถูก expose เป็น Typed Action (ชื่อ \+ พารามิเตอร์แบบ JSON-Schema \+ คลาสของ Side-effect: ReadOnly / Mutating / LongJob) และต้อง resolve ได้ด้วยชื่อผ่าน Registry ตัวเดียว  
* **In-app Agent:** ระบบต้องรับข้อความภาษาธรรมชาติ (Natural Language) แล้วขับเคลื่อนเครื่องมือ (Tools) ผ่านลูป Tool-calling ของ LLM และตอบกลับเป็นภาษาธรรมชาติ โดยโมเดลเริ่มต้น (Default) ต้องทำงานบนเครื่อง (Local ผ่าน Ollama)  
* **Voice Input (Planned):** เสียงพูดต้องถูกถอดความ (Transcribe) เป็นข้อความ แล้วป้อนเข้าสู่ลูปของ Agent ตัวเดียวกันกับ In-app Agent  
* **External Tool Interface:** ระบบต้อง expose Action Registry ออกไปภายนอกผ่าน MCP (stdio) และผ่าน Headless CLI (`--agent`, `--mcp`)  
* **Media Generation:** ระบบต้อง route คำขอสร้างภาพ (Image), เสียงพูด (Speech), และการถอดความ (Transcription) ผ่าน Media Broker ที่รองรับ Backend แบบ pluggable ได้หลายตัว

## **4\. ความต้องการด้านประสิทธิภาพ (Performance Requirements)**

* **Latency:** การสลับโหมดการทำงานต้องใช้เวลาน้อยกว่า 500 มิลลิวินาที  
* **Node Rendering:** ระบบ Workflow ต้องรองรับการแพนและซูมบนพื้นที่ขนาดใหญ่ (Canvas) โดยไม่กระตุก (Smooth panning/zooming)  
* **Concurrency:** ระบบต้องรองรับการประมวลผลคลาวด์แบบขนาน (Async API Calls) โดยไม่มีการหยุดชะงักของ UI  
* **Resource Arbitration (AI Copilot):** โมเดลสมอง (Brain LLM) และโมเดล Diffusion สำหรับ Media ต้องทำงานแบบ serialize บน GPU กล่าวคือ Brain ต้องถูก unload ออกจาก VRAM เมื่อมีงาน Media ที่ใช้ทรัพยากรหนัก เพื่อไม่ให้แย่งชิงหน่วยความจำ GPU กัน

## **5\. ความต้องการด้าน UI/UX (UI/UX Requirements)**

* **Theme:** ใช้ Dark Mode เป็นหลัก (พื้นหลัง \#0d0d0d) เพื่อถนอมสายตาสำหรับงานตัดต่อ  
* **Interaction:** \* Workflow View: รองรับการลากวาง (Drag-and-drop) Node และเส้นเชื่อมต่อ  
  * Timeline View: รองรับการลากปรับเวลาและการใช้ Playhead  
* **Responsive:** UI ต้องปรับขนาดตามความละเอียดหน้าจอโดยไม่ทำให้ส่วนประกอบหลักเสียสัดส่วน

## **6\. ข้อกำหนดด้านความปลอดภัย (Security Requirements)**

* การเชื่อมต่อกับ Local (Comfy) ต้องมีระบบ Authentication ภายในเครือข่าย  
* การเชื่อมต่อ Cloud (API) ต้องใช้ Token-based Authentication เพื่อความปลอดภัยของข้อมูล  
* **Write Gating (AI Copilot):** Action ประเภท Mutating และ LongJob ต้อง **ไม่** ถูกสั่งทำงานจาก Agent เว้นแต่ผู้ใช้จะเปิด opt-in `allow_writes` อย่างชัดเจน ส่วน Action ประเภท ReadOnly สามารถทำงานได้อย่างอิสระ
## 7. Implementation Status Note (2026-07-04)

This SRS remains the system-target document. The current repository implementation status is:

- A functional dual-runtime app exists with browser mode and desktop Tauri mode.
- Workflow graph validation, timeline-workflow linking, audio scheduling, export queue behavior, and resilience tooling are implemented in code.
- Vitest is configured with current test coverage for workflow node-definition invariants and audio scheduling logic.
- The AI Copilot layer (§3.5) is core-implemented: action registry, in-app tool-calling agent (local Ollama default), MCP (stdio) + headless CLI (`--agent`, `--mcp`), media broker, write-gating (`allow_writes`), and GPU resource arbitration are in code. Pending: the voice-input UI surface and an in-process llama.cpp backend.
- The main unfinished area is not feature absence, but Section 11 proof breadth across multiple OS targets and hardware tiers.
- For the latest repo-backed status, see `MASTERPLAN Completion Audit.md` and `MASTERPLAN Performance Evidence Audit.md`.
