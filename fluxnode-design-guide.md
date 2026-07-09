# **FluxNode \- Visual & Technical Guide (Canva Layout)**

## **Page 1: Title Slide**

* **Headline:** FluxNode  
* **Sub-headline:** The AI-Native Video Editing Ecosystem  
* **Visual Suggestion:** ใช้พื้นหลังสี \#0d0d0d พร้อมกราฟิกเส้น Node เรืองแสงสี \#e0ff00

## **Page 2: Vision & Mission**

* **Headline:** Redefining Video Creation  
* **Body:** FluxNode is the bridge between traditional timeline editing and AI-generative node workflows.  
* **Key Differentiator:** Seamlessly switch between Human-controlled Timeline and AI-powered Node Pipelines.

## **Page 3: Design System (Color Palette)**

* **Headline:** Visual Identity  
* **Color Palette (Copy these Hex codes to Canva Brand Kit):**  
  * **Background (Primary):** \#0d0d0d  
  * **Surface (Secondary):** \#1c1c1e  
  * **Accent (Neon):** \#e0ff00  
  * **Cloud (Brand Blue):** \#3b82f6  
  * **Status (Success/Warning):** \#4ade80 / \#f87171  
* **Typography:**  
  * **Headers:** Inter / Geist (Bold, 24px+)  
  * **Body:** Inter / Geist (Regular, 16px)

## **Page 4: User Interface Philosophy**

* **Headline:** Core Principles  
* **Dark-First:** Designed for long-session comfort.  
* **Functional Contrast:** Neon highlights to indicate process state (Node active/inactive).  
* **Fluid Interaction:** Glassmorphism (backdrop-blur-md) for a modern, depth-focused interface.

## **Page 5: Tech Architecture (The Engine)**

* **Headline:** High-Performance Stack  
* **Frontend:** React \+ Tailwind CSS \+ custom Timeline / Workflow UI  
* **Logic/State:** Zustand  
* **The Core:** Rust (Tauri backend) \+ TypeScript domain/store logic  
* **AI Integration:** Optional user-run ComfyUI via desktop-only commands  
* **Connectivity:** Tauri IPC \+ HTTP polling / fetch-based health checks  
* **Bridge:** Tauri (Desktop Native Experience)

## **Page 6: Roadmap**

* **Phase 1: Implemented** \- Core Timeline, View Switching, persistence, audio, export, validation, and onboarding.  
* **Phase 2: Implemented in repo** \- Node-based canvas, local ComfyUI integration hooks, proof tooling, and workflow performance guardrails.  
* **Phase 3: In progress** \- Cross-machine proof breadth for Section 11, plus further desktop-product polish.
