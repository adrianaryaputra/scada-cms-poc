# Developer's Guide: HMI Application (JavaScript Modules)

## 1. Overview

This document provides a guide for developers working on the JavaScript modules of the HMI (Human-Machine Interface) application. The application allows users to design HMI screens by adding and configuring components, linking them to device data, and simulating their behavior. It also features an AI assistant to help with design tasks.

The frontend is structured modularly, with various "manager" modules handling specific aspects of the application. Communication primarily occurs through direct function calls during initialization (passing references and callbacks) and through a centralized state management system.

## 2. Architecture

The application follows a modular architecture centered around a main `app.js` entry point that initializes and coordinates all other modules.

**Core Principles:**

*   **Modularity:** Each major functionality (UI, state, graphics, devices, etc.) is encapsulated in its own manager module.
*   **Single Responsibility (Attempted):** Managers aim to handle a specific domain of the application.
*   **Dependency Injection (Basic):** References to other managers or core objects (like the Konva stage or Socket.IO client) are typically passed during the `init` function of each module.
*   **Centralized State:** `stateManager.js` holds the application's core state, including HMI component configurations and live device data (tag database).
*   **Event-Driven (UI):** User interactions in the DOM trigger event listeners primarily set up by `uiManager.js` and `aiAssistant.js`. Konva.js also has its own event system for canvas interactions, managed by `konvaManager.js` and `componentFactory.js`.

## 3. Modules/Managers

Here's a description of each major JavaScript module located in the `js/` directory:

### 3.1. `app.js`
*   **Role:** Main application entry point.
*   **Responsibilities:**
    *   Initializes all other core modules in a specific order due to dependencies.
    *   Sets up global application state variables (e.g., `isSimulationMode`, `chatHistory`).
    *   Manages the simulation loop interval.
    *   Handles global event listeners like `beforeunload` for unsaved changes and Undo/Redo button clicks.
    *   Coordinates the overall application structure and flow by passing necessary references and callbacks between managers.
*   **Key Interactions:** Initializes and orchestrates all other managers.

### 3.2. `stateManager.js`
*   **Role:** Manages the application's state.
*   **Responsibilities:**
    *   Manages the `undoStack` and `redoStack` for undo/redo functionality.
    *   Maintains the `tagDatabase`, a live record of device variable values.
    *   Provides functions to `saveState` (HMI components and tags), `restoreState`, `handleUndo`, `handleRedo`.
    *   Manages getting (`getDeviceVariableValue`) and setting (`setDeviceVariableValue`) device variable values, which includes notifying relevant HMI components to update their visual state.
    *   Handles deletion of device or variable states from the `tagDatabase`.
*   **Key Interactions:**
    *   `componentFactory`: For recreating components during `restoreState`.
    *   `konvaManager` (indirectly): To access HMI components on the layer for saving/restoring.
    *   `deviceManager`: `updateLiveVariableValueInManagerUI` is called to refresh the device manager's UI. `setDeviceVariableValue` is called by `deviceManager` on receiving new data.
    *   `ProjectManager`: `setDirty(true)` is called when state changes.
    *   HMI Components: Their `updateState` methods are called by `setDeviceVariableValue`.

### 3.3. `konvaManager.js`
*   **Role:** Manages the Konva.js stage, layers, shapes, and graphical interactions.
*   **Responsibilities:**
    *   Initializes the Konva `Stage` and various `Layer`s (grid, main HMI components, guidelines).
    *   Manages the Konva `Transformer` for resizing/rotating components.
    *   Draws the background grid.
    *   Handles drag-and-drop logic for HMI components, including snapping to grid and other components' edges/centers.
    *   Implements marquee selection.
    *   Integrates with `uiManager` for displaying and positioning the context menu.
    *   Provides functions to get the current HMI layout as JSON and to clear the canvas.
*   **Key Interactions:**
    *   `uiManager`: Calls `uiManager` functions to show/hide/populate the context menu and to update selection. Receives `set/getCurrentContextMenuNode` functions.
    *   `componentFactory`: Provides the main layer and transformer to `componentFactory`. Its `handleDragMove` is used by components.
    *   `stateManager`: Calls `saveState` after drag operations or context menu modifications. Uses `getCurrentState` to check for changes.

### 3.4. `deviceManager.js`
*   **Role:** Manages device configurations, communication with the server for device data, and the UI for device/variable management.
*   **Responsibilities:**
    *   Maintains a local cache (`localDeviceCache`) of device configurations.
    *   Handles Socket.IO communication for the `/devices` namespace:
        *   Receives initial device lists, updates, deletions, status changes, and live variable updates from the server.
        *   Emits events to the server for adding, editing, or deleting devices, and for writing data to devices.
    *   Manages UI modals and forms for:
        *   Adding, editing, and listing devices.
        *   Managing variables for each device (name, type, MQTT topics, etc.).
    *   Updates `stateManager` when live variable data is received (`setDeviceVariableValue`).
    *   Clears device state from `stateManager` when devices are deleted.
    *   Interacts with `ProjectManager` to mark the project as dirty on configuration changes.
    *   Integrates with `topicExplorer.js` to allow users to explore MQTT topics.
*   **Key Interactions:**
    *   Socket.IO client: For all server communication regarding devices.
    *   `stateManager`: For updating and clearing device variable values.
    *   `ProjectManager`: Notifies of changes that make the project dirty.
    *   `topicExplorer`: Opens the topic explorer UI.
    *   DOM: Extensive interaction for modals and forms.

### 3.5. `projectManager.js`
*   **Role:** Handles project lifecycle operations (new, save, load, import, export).
*   **Responsibilities:**
    *   Manages the current project's name (`currentProjectName`) and dirty status (`isDirty`).
    *   Aggregates project data (HMI layout from `konvaManager`, device configurations from `deviceManager`) for saving and exporting.
    *   Handles Socket.IO communication for server-side project operations:
        *   `project:save`: Sends project data to the server.
        *   `project:load`: Requests project data from the server.
        *   `project:list`: Requests a list of available projects.
    *   Handles client-side import (reading JSON file with `FileReader`) and export (creating and downloading JSON file).
    *   Coordinates with other managers during project load/new:
        *   `konvaManager.clearCanvas()`.
        *   `componentFactory.create()` to reconstruct HMI from loaded data.
        *   `deviceManager.initializeDevicesFromConfigs()` or `clearAllClientDevices()`.
        *   `stateManager.saveState()` to set an initial state for undo.
*   **Key Interactions:**
    *   `konvaManagerRef`: To get HMI layout and clear canvas.
    *   `componentFactoryRef`: To recreate HMI components when loading/importing.
    *   `socketRef`: For server-side project operations.
    *   `deviceManager`: To get device configs for export, and to manage devices during load/new/import.
    *   `stateManager`: To save initial state.

### 3.6. `componentFactory.js`
*   **Role:** Centralized factory for creating all HMI components.
*   **Responsibilities:**
    *   Defines creation logic for each component type (e.g., `BitLamp`, `BitSwitch`, `NumericDisplay`, `Label`).
    *   Instantiates Konva.js `Group` objects for each component.
    *   Adds specific Konva shapes (Rect, Circle, Text) to the group to form the component's visual representation.
    *   Sets default properties for components and allows overrides via input `props`.
    *   Attaches common event handlers (e.g., for dragging, selection click via `handleComponentSelectionClick` helper).
    *   Attaches component-specific event handlers (e.g., click behavior for `BitSwitch` in simulation mode).
    *   Defines an `updateState` method on each component, which is called to refresh its appearance based on data from `stateManager`.
*   **Key Interactions:**
    *   Konva.js: Heavily uses Konva objects to build components.
    *   `stateManager`: Uses `getDeviceVariableValue` within components' `updateState` methods. Calls `saveState` after label transformations.
    *   `deviceManager`: Uses `writeDataToServer` from within `BitSwitch` to send data.
    *   Receives references from `konvaManager` (layer, transformer, stage access, drag handling) and `uiManager` (selection function) via `initComponentFactory`.

### 3.7. `uiManager.js`
*   **Role:** Manages most user interface elements, interactions, and visual feedback (modals, context menus, toasts).
*   **Responsibilities:**
    *   Caches DOM elements for UI controls, modals, panels, etc.
    *   Sets up event listeners for buttons, inputs, and global keyboard shortcuts.
    *   Handles the Design/Simulation mode toggle, updating UI and component draggability.
    *   Manages the HMI component context menu:
        *   Populating it with properties based on the selected component type.
        *   Handling changes made to properties in the context menu and updating the component's attributes.
    *   Implements copy/paste functionality for HMI components.
    *   Controls modals for: Load Project, Save Project (As), and generic Confirmations.
    *   Displays toast notifications for user feedback.
    *   Manages the AI assistant chat popup and settings panel visibility.
    *   Handles persistence of the Gemini API key via `localStorage`.
*   **Key Interactions:**
    *   DOM: Extensive manipulation and event listening.
    *   `stateManager`: Calls `saveState`, `handleUndo`, `handleRedo`, `deleteDeviceVariableState`.
    *   `componentFactory`: Used for pasting components.
    *   `deviceManager`: Uses `getDevices` for context menu.
    *   `konvaManagerRef`: Interacts with Konva selections, transformer, and context menu closure.
    *   `projectManagerRef`: Initiates project operations (new, save, load, etc.) based on user actions.
    *   `app.js` (indirectly): Receives simulation mode status and control functions.

### 3.8. `aiAssistant.js`
*   **Role:** Manages the AI chat functionality and AI-driven HMI modifications.
*   **Responsibilities:**
    *   Handles user input from the chat interface.
    *   Constructs system prompts and payloads for the Gemini (or other) AI API, including canvas context and chat history.
    *   Manages API key retrieval (from UI input or `localStorage`).
    *   Makes `fetch` requests to the AI API.
    *   Parses JSON responses from the AI, which are expected to follow a defined schema (`AI_RESPONSE_SCHEMA`) of actions.
    *   Executes these actions:
        *   `add`: Creates new components using `componentFactory`.
        *   `update`: Modifies attributes of existing components.
        *   `delete`: Removes components from the canvas and clears their state.
        *   `clarify`: Displays a clarification message from the AI to the user.
    *   Updates the chat log with user messages, AI responses, and thinking details.
*   **Key Interactions:**
    *   `utils.js`: For chat log updates, getting canvas context, and UI loading states.
    *   `componentFactory`: To create components based on AI instructions.
    *   `stateManager`: To `saveState` after AI actions and `deleteDeviceVariableState` for deleted components.
    *   `konvaRefsForAI`: To get canvas context and manipulate components.
    *   DOM: For chat UI elements.
    *   `fetch` API: For communication with the AI model.

### 3.9. `utils.js`
*   **Role:** Provides common utility functions used across the application.
*   **Responsibilities:**
    *   `updateStatus`: Displays temporary status messages in the UI.
    *   `addMessageToChatLog`: Appends messages to the AI chat log and history array.
    *   `addThinkingDetails`: Displays AI's reasoning/plan in the chat log.
    *   `getCanvasContext`: Generates a textual summary of the HMI canvas for the AI.
    *   `setLoadingState`: Enables/disables UI elements during async operations.
*   **Key Interactions:** Used by various managers, especially `aiAssistant.js` and `app.js`.

### 3.10. `config.js`
*   **Role:** Stores application-wide configuration constants.
*   **Responsibilities:** Currently defines `GRID_SIZE`.
*   **Key Interactions:** Used by `konvaManager` for grid drawing/snapping and potentially by `aiAssistant` for layout suggestions.

## 4. Data Flow & Communication

*   **Initialization (`app.js`):**
    1.  Socket.IO connection for devices is established.
    2.  `deviceManager` and `topicExplorer` are initialized with the socket.
    3.  `uiManager` is initialized, receiving callbacks for simulation mode and a reference to `ProjectManager`.
    4.  `konvaManager` is initialized, receiving callbacks from `uiManager` and `stateManager`.
    5.  The fully initialized `konvaManager` interface is passed back to `uiManager` (via `setKonvaRefs`).
    6.  `stateManager` is initialized with `componentFactory`, Konva refs, and DOM button refs.
    7.  `componentFactory` is initialized with Konva refs and UI/Konva manager callbacks.
    8.  `ProjectManager` is initialized with Konva refs, `componentFactory`, and the device socket.
    9.  `aiAssistant` is initialized with DOM elements, chat history accessors, and Konva refs.

*   **User Interaction -> UI Update:**
    *   User clicks a button (e.g., "Add BitLamp" in `uiManager`).
    *   `uiManager`'s event listener calls `componentFactory.create("bit-lamp")`.
    *   `componentFactory` creates the Konva group, adds it to `konvaManager`'s layer.
    *   `uiManager` (or the action itself) calls `stateManager.saveState()`.

*   **State Change -> Component Update:**
    *   `deviceManager` receives a `device_variable_update` from the server.
    *   `deviceManager` calls `stateManager.setDeviceVariableValue(deviceId, varName, value)`.
    *   `stateManager` updates its `tagDatabase`.
    *   `stateManager` iterates through components on `konvaManager`'s layer and calls `updateState()` on matching components.
    *   The component's `updateState()` method (defined in `componentFactory`) reads the new value using `getDeviceVariableValue` and updates its Konva shapes.

*   **AI Interaction Flow:**
    1.  User types a prompt in `aiAssistant`'s chat input.
    2.  `handleSendMessage` is triggered.
    3.  Canvas context is gathered using `utils.getCanvasContext` (which reads from `konvaManager`).
    4.  Payload is constructed (system prompt, context, history, schema).
    5.  `fetch` request is made to Gemini API.
    6.  Response is parsed; `executeAIActions` is called.
    7.  `executeAIActions` uses `componentFactory` (for "add"), Konva methods on nodes (for "update", "delete"), and `stateManager` (`saveState`, `deleteDeviceVariableState`).
    8.  Chat log is updated via `utils.addMessageToChatLog/addThinkingDetails`.

## 5. Key Design Decisions during Refactoring

*   **Enhanced JSDoc:** Significant effort was made to add comprehensive JSDoc comments to all modules and functions to improve understanding and maintainability.
*   **Clarified Dependencies:** The initialization sequence in `app.js` was reviewed, and comments were added to clarify the dependencies between modules. The passing of interfaces (like `konvaManagerInterface`) was made more explicit.
*   **Unit Testing:** A major focus was the introduction of unit tests for all core managers and utility files using Jest. This involved extensive mocking of dependencies (DOM, Konva, Socket.IO, other managers) to isolate units for testing.
*   **No Major Architectural Overhaul:** While areas for more advanced design patterns (e.g., full reactive state, event bus) were noted, the refactoring focused on improving the existing structure, documentation, and testability rather than a complete rewrite. Legacy patterns (like `setDeviceVariableValue` iterating components) were documented with their trade-offs.
*   **Consistent Naming:** Efforts were made to use consistent naming for similar concepts across modules (e.g., "manager interfaces" in `app.js`).

## 6. Future Considerations

*   **Reactive State Management:** Transitioning `stateManager` and component updates to a more reactive (observer/subscriber) pattern could improve performance and simplify update logic.
*   **Event Bus/Aggregator:** For more complex inter-module communication beyond direct DI, an event bus could further decouple modules.
*   **Advanced AI Actions:** The `executeAIActions` in `aiAssistant.js` could be refactored using a Command or Strategy pattern if the number and complexity of AI actions grow significantly.
*   **Error Handling:** While basic error handling is present, a more centralized and user-friendly error reporting mechanism could be beneficial.
*   **Build Process/Bundling:** For production, a build process (e.g., using Webpack or Parcel) would be necessary to bundle modules, minify code, and manage assets.
---
This guide provides a starting point for understanding the HMI application's frontend JavaScript codebase.
Refer to individual module JSDoc comments for more detailed information on specific functions and their implementations.
