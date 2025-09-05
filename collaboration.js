// Enhanced Collaboration Features

// Declare missing variables
const currentFile = ""
const currentUsername = ""
let monaco = null

// 1. Real-time Cursor Tracking
class CursorTracker {
    constructor(socket, editor, roomId, username) {
        this.socket = socket
        this.editor = editor
        this.roomId = roomId
        this.username = username
        this.cursors = new Map() // Map of socketId -> cursor elements
        this.cursorColors = {} // Map of socketId -> cursor color
        this.lastCursorPosition = { lineNumber: 1, column: 1 }
        this.throttleTimeout = null
        this.THROTTLE_DELAY = 50 // ms

        this.init()
    }

    init() {
        // Initialize cursor tracking
        this.setupCursorTracking()
        this.setupCursorListeners()
    }

    setupCursorTracking() {
        if (!this.editor) return

        // Track local cursor position
        this.editor.onDidChangeCursorPosition((e) => {
            this.lastCursorPosition = e.position

            // Throttle emission of cursor position
            if (!this.throttleTimeout) {
                this.throttleTimeout = setTimeout(() => {
                    this.emitCursorPosition()
                    this.throttleTimeout = null
                }, this.THROTTLE_DELAY)
            }
        })
    }

    setupCursorListeners() {
        if (!this.socket) return

        // Listen for cursor updates from other users
        this.socket.on("cursor-position", (data) => {
            if (data.socketId === this.socket.id) return // Ignore own cursor

            this.updateRemoteCursor(data)
        })

        // Remove cursors when users disconnect
        this.socket.on("user-disconnected", (socketId) => {
            this.removeRemoteCursor(socketId)
        })
    }

    emitCursorPosition() {
        if (!this.socket || !this.socket.connected) return

        const position = this.lastCursorPosition
        const editorModel = this.editor.getModel()

        if (!editorModel) return

        // Get the position in the text
        const offset = editorModel.getOffsetAt(position)

        this.socket.emit("cursor-position", {
            roomId: this.roomId,
            socketId: this.socket.id,
            username: this.username,
            position: position,
            offset: offset,
            fileName: currentFile,
        })
    }

    updateRemoteCursor(data) {
        if (!this.editor || !data.fileName || data.fileName !== currentFile) return

        const { socketId, username, position } = data

        // Get or create cursor element
        let cursorElement = this.cursors.get(socketId)

        if (!cursorElement) {
            // Create new cursor elements
            cursorElement = this.createCursorElement(socketId, username)
            this.cursors.set(socketId, cursorElement)
        }

        // Update cursor position
        const viewPosition = this.editor.getScrolledVisiblePosition(position)
        if (!viewPosition) return

        const { top, left } = viewPosition

        cursorElement.cursor.style.top = `${top}px`
        cursorElement.cursor.style.left = `${left}px`
        cursorElement.label.style.top = `${top - 20}px`
        cursorElement.label.style.left = `${left}px`
    }

    createCursorElement(socketId, username) {
        // Generate a unique color for this user
        const color = this.getColorForUser(socketId)

        // Create cursor element
        const cursor = document.createElement("div")
        cursor.className = "remote-cursor"
        cursor.style.backgroundColor = color
        cursor.style.height = "18px"

        // Create label element
        const label = document.createElement("div")
        label.className = "cursor-label"
        label.textContent = username
        label.style.backgroundColor = color

        // Add to editor container
        const editorContainer = document.getElementById("editorContainer")
        if (editorContainer) {
            editorContainer.appendChild(cursor)
            editorContainer.appendChild(label)
        }

        return { cursor, label }
    }

    removeRemoteCursor(socketId) {
        const cursorElement = this.cursors.get(socketId)
        if (cursorElement) {
            cursorElement.cursor.remove()
            cursorElement.label.remove()
            this.cursors.delete(socketId)
        }
    }

    getColorForUser(socketId) {
        if (this.cursorColors[socketId]) {
            return this.cursorColors[socketId]
        }

        // Generate a unique color based on socketId
        const colors = ["#FF5733", "#33FF57", "#3357FF", "#FF33A8", "#33A8FF", "#A833FF", "#FF8333", "#33FFC1"]

        const colorIndex = socketId.charCodeAt(0) % colors.length
        this.cursorColors[socketId] = colors[colorIndex]

        return this.cursorColors[socketId]
    }

    cleanup() {
        // Remove all remote cursors
        this.cursors.forEach((cursorElement) => {
            cursorElement.cursor.remove()
            cursorElement.label.remove()
        })

        this.cursors.clear()

        // Clear timeout
        if (this.throttleTimeout) {
            clearTimeout(this.throttleTimeout)
            this.throttleTimeout = null
        }
    }
}

// 2. Code Annotations
class CodeAnnotations {
    constructor(editor, socket, roomId) {
        this.editor = editor
        this.socket = socket
        this.roomId = roomId
        this.annotations = new Map() // Map of id -> annotation
        this.nextAnnotationId = 1

        this.init()
    }

    init() {
        this.setupAnnotationListeners()
        this.setupAnnotationCommands()
    }

    setupAnnotationListeners() {
        if (!this.socket) return

        // Listen for new annotations from other users
        this.socket.on("annotation-added", (data) => {
            if (data.fileName !== currentFile) return
            this.addAnnotation(data, false)
        })

        // Listen for annotation updates
        this.socket.on("annotation-updated", (data) => {
            if (data.fileName !== currentFile) return
            this.updateAnnotation(data, false)
        })

        // Listen for annotation deletions
        this.socket.on("annotation-deleted", (data) => {
            if (data.fileName !== currentFile) return
            this.removeAnnotation(data.id, false)
        })

        // Request existing annotations when switching files
        this.socket.on("sync-annotations", (data) => {
            if (data.fileName !== currentFile) return

            // Clear existing annotations
            this.clearAnnotations()

            // Add received annotations
            data.annotations.forEach((annotation) => {
                this.addAnnotation(annotation, false)
            })
        })
    }

    setupAnnotationCommands() {
        if (!this.editor || !monaco) return

        // Add command to create annotation at current position
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA, () => {
            this.createAnnotationAtCursor()
        })
    }

    createAnnotationAtCursor() {
        const position = this.editor.getPosition()
        if (!position) return

        // Create annotation input dialog
        const annotationText = prompt("Enter annotation:")
        if (!annotationText) return

        const annotation = {
            id: this.nextAnnotationId++,
            lineNumber: position.lineNumber,
            text: annotationText,
            author: currentUsername,
            timestamp: new Date().toISOString(),
            fileName: currentFile,
        }

        // Add annotation locally
        this.addAnnotation(annotation, true)
    }

    addAnnotation(annotation, emitToServer) {
        if (!this.editor || !monaco) return

        const { id, lineNumber, text, author } = annotation

        // Create decoration for the annotation
        const decorations = this.editor.deltaDecorations(
            [], [{
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: "annotation-line",
                    glyphMarginClassName: "annotation-glyph",
                    glyphMarginHoverMessage: { value: `${author}: ${text}` },
                    overviewRuler: {
                        color: "#FFD700",
                        position: monaco.editor.OverviewRulerLane.Right,
                    },
                },
            }, ],
        )

        // Store annotation with its decoration ID
        this.annotations.set(id, {
            ...annotation,
            decorationId: decorations[0],
        })

        // Emit to server if needed
        if (emitToServer && this.socket && this.socket.connected) {
            this.socket.emit("add-annotation", {
                roomId: this.roomId,
                annotation: annotation,
            })
        }
    }

    updateAnnotation(annotation, emitToServer) {
        const { id, text } = annotation
        const existingAnnotation = this.annotations.get(id)

        if (!existingAnnotation || !monaco) return

        // Update the annotation text
        existingAnnotation.text = text

        // Update the decoration
        this.editor.deltaDecorations(
            [existingAnnotation.decorationId], [{
                range: new monaco.Range(existingAnnotation.lineNumber, 1, existingAnnotation.lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: "annotation-line",
                    glyphMarginClassName: "annotation-glyph",
                    glyphMarginHoverMessage: { value: `${existingAnnotation.author}: ${text}` },
                    overviewRuler: {
                        color: "#FFD700",
                        position: monaco.editor.OverviewRulerLane.Right,
                    },
                },
            }, ],
        )

        // Emit to server if needed
        if (emitToServer && this.socket && this.socket.connected) {
            this.socket.emit("update-annotation", {
                roomId: this.roomId,
                annotation: annotation,
            })
        }
    }

    removeAnnotation(id, emitToServer) {
        const annotation = this.annotations.get(id)
        if (!annotation) return

        // Remove decoration
        this.editor.deltaDecorations([annotation.decorationId], [])

        // Remove from map
        this.annotations.delete(id)

        // Emit to server if needed
        if (emitToServer && this.socket && this.socket.connected) {
            this.socket.emit("delete-annotation", {
                roomId: this.roomId,
                id: id,
                fileName: currentFile,
            })
        }
    }

    clearAnnotations() {
        // Remove all decorations
        const decorationIds = Array.from(this.annotations.values()).map((a) => a.decorationId)
        this.editor.deltaDecorations(decorationIds, [])

        // Clear map
        this.annotations.clear()
    }

    getAnnotationsForFile(fileName) {
        return Array.from(this.annotations.values())
            .filter((a) => a.fileName === fileName)
            .map(({ decorationId, ...annotation }) => annotation) // Remove decorationId
    }
}

// 3. Collaborative Debugging
class CollaborativeDebugging {
    constructor(editor, socket, roomId) {
        this.editor = editor
        this.socket = socket
        this.roomId = roomId
        this.breakpoints = new Map() // Map of id -> breakpoint
        this.nextBreakpointId = 1
        this.isDebugging = false
        this.debugState = null

        this.init()
    }

    init() {
        this.setupDebuggerUI()
        this.setupBreakpointListeners()
        this.setupDebuggerListeners()
    }

    setupDebuggerUI() {
        // Create debugger panel
        const debuggerPanel = document.createElement("div")
        debuggerPanel.id = "debuggerPanel"
        debuggerPanel.className = "debugger-panel"
        debuggerPanel.innerHTML = `
            <div class="debugger-header">
                <h3>Collaborative Debugger</h3>
                <div class="debugger-controls">
                    <button id="startDebug" class="debug-btn"><i class="fas fa-bug"></i> Start Debugging</button>
                    <button id="stopDebug" class="debug-btn" disabled><i class="fas fa-stop"></i> Stop</button>
                    <button id="stepOver" class="debug-btn" disabled><i class="fas fa-step-forward"></i> Step Over</button>
                    <button id="stepInto" class="debug-btn" disabled><i class="fas fa-level-down-alt"></i> Step Into</button>
                    <button id="stepOut" class="debug-btn" disabled><i class="fas fa-level-up-alt"></i> Step Out</button>
                    <button id="continue" class="debug-btn" disabled><i class="fas fa-play"></i> Continue</button>
                </div>
            </div>
            <div class="debugger-content">
                <div class="debugger-variables">
                    <h4>Variables</h4>
                    <div id="variablesList"></div>
                </div>
                <div class="debugger-call-stack">
                    <h4>Call Stack</h4>
                    <div id="callStackList"></div>
                </div>
            </div>
        `

        // Add to the main layout
        const mainLayout = document.querySelector(".main-layout")
        if (mainLayout) {
            mainLayout.appendChild(debuggerPanel)
        }

        // Add event listeners to debug buttons
        document.getElementById("startDebug").addEventListener("click", () => this.startDebugging())
        document.getElementById("stopDebug").addEventListener("click", () => this.stopDebugging())
        document.getElementById("stepOver").addEventListener("click", () => this.stepOver())
        document.getElementById("stepInto").addEventListener("click", () => this.stepInto())
        document.getElementById("stepOut").addEventListener("click", () => this.stepOut())
        document.getElementById("continue").addEventListener("click", () => this.continueExecution())

        // Add glyph margin to editor for breakpoints
        if (this.editor && monaco) {
            this.editor.updateOptions({
                glyphMargin: true,
            })

            // Add click handler for setting breakpoints
            this.editor.onMouseDown((e) => {
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    this.toggleBreakpoint(e.target.position.lineNumber)
                }
            })
        }
    }

    setupBreakpointListeners() {
        if (!this.socket) return

        // Listen for breakpoint changes from other users
        this.socket.on("breakpoint-added", (data) => {
            if (data.fileName !== currentFile) return
            this.addBreakpoint(data.lineNumber, data.id, false)
        })

        this.socket.on("breakpoint-removed", (data) => {
            if (data.fileName !== currentFile) return
            this.removeBreakpoint(data.id, false)
        })

        // Listen for debug state changes
        this.socket.on("debug-started", (data) => {
            this.handleDebugStarted(data)
        })

        this.socket.on("debug-stopped", () => {
            this.handleDebugStopped()
        })

        this.socket.on("debug-paused", (data) => {
            this.handleDebugPaused(data)
        })

        this.socket.on("debug-continued", () => {
            this.handleDebugContinued()
        })

        this.socket.on("debug-step-completed", (data) => {
            this.handleDebugStepCompleted(data)
        })
    }

    setupDebuggerListeners() {
        // These would connect to the actual debugger implementation
        // For now, we'll simulate debugging behavior
    }

    toggleBreakpoint(lineNumber) {
        // Check if breakpoint already exists at this line
        const existingBreakpoint = Array.from(this.breakpoints.values()).find(
            (bp) => bp.lineNumber === lineNumber && bp.fileName === currentFile,
        )

        if (existingBreakpoint) {
            this.removeBreakpoint(existingBreakpoint.id, true)
        } else {
            const id = this.nextBreakpointId++
                this.addBreakpoint(lineNumber, id, true)
        }
    }

    addBreakpoint(lineNumber, id, emitToServer) {
        if (!this.editor || !monaco) return

        // Create decoration for the breakpoint
        const decorations = this.editor.deltaDecorations(
            [], [{
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: false,
                    glyphMarginClassName: "breakpoint-glyph",
                },
            }, ],
        )

        // Store breakpoint
        this.breakpoints.set(id, {
            id,
            lineNumber,
            fileName: currentFile,
            decorationId: decorations[0],
            enabled: true,
        })

        // Emit to server if needed
        if (emitToServer && this.socket && this.socket.connected) {
            this.socket.emit("add-breakpoint", {
                roomId: this.roomId,
                lineNumber,
                fileName: currentFile,
                id,
            })
        }
    }

    removeBreakpoint(id, emitToServer) {
        const breakpoint = this.breakpoints.get(id)
        if (!breakpoint || !this.editor) return

        // Remove decoration
        this.editor.deltaDecorations([breakpoint.decorationId], [])

        // Remove from map
        this.breakpoints.delete(id)

        // Emit to server if needed
        if (emitToServer && this.socket && this.socket.connected) {
            this.socket.emit("remove-breakpoint", {
                roomId: this.roomId,
                id,
                fileName: currentFile,
            })
        }
    }

    startDebugging() {
        if (this.isDebugging) return

        // Get all breakpoints for the current file
        const fileBreakpoints = Array.from(this.breakpoints.values())
            .filter((bp) => bp.fileName === currentFile)
            .map(({ id, lineNumber, fileName }) => ({ id, lineNumber, fileName }))

        // Emit debug start event
        if (this.socket && this.socket.connected) {
            this.socket.emit("start-debugging", {
                roomId: this.roomId,
                fileName: currentFile,
                breakpoints: fileBreakpoints,
            })
        }

        // Update UI
        this.updateDebuggerUI(true)

        // For demo purposes, simulate hitting the first breakpoint after a delay
        setTimeout(() => {
            if (fileBreakpoints.length > 0) {
                const firstBreakpoint = fileBreakpoints[0]
                this.handleDebugPaused({
                    lineNumber: firstBreakpoint.lineNumber,
                    variables: {
                        x: 10,
                        y: 20,
                        result: 30,
                    },
                    callStack: [
                        { name: "calculate", line: firstBreakpoint.lineNumber, file: currentFile },
                        { name: "main", line: 1, file: currentFile },
                    ],
                })
            }
        }, 1000)
    }

    stopDebugging() {
        if (!this.isDebugging) return

        // Emit debug stop event
        if (this.socket && this.socket.connected) {
            this.socket.emit("stop-debugging", {
                roomId: this.roomId,
            })
        }

        // Update UI
        this.updateDebuggerUI(false)
        this.clearDebugState()
    }

    stepOver() {
        if (!this.isDebugging || !this.debugState) return

        // Emit step over event
        if (this.socket && this.socket.connected) {
            this.socket.emit("debug-step-over", {
                roomId: this.roomId,
            })
        }

        // For demo purposes, simulate stepping to the next line
        const currentLine = this.debugState.lineNumber
        setTimeout(() => {
            this.handleDebugStepCompleted({
                lineNumber: currentLine + 1,
                variables: {
                    x: 10,
                    y: 20,
                    result: 30,
                },
                callStack: this.debugState.callStack,
            })
        }, 500)
    }

    stepInto() {
        if (!this.isDebugging || !this.debugState) return

        // Emit step into event
        if (this.socket && this.socket.connected) {
            this.socket.emit("debug-step-into", {
                roomId: this.roomId,
            })
        }

        // For demo purposes, simulate stepping into a function
        setTimeout(() => {
            const newCallStack = [{ name: "innerFunction", line: 15, file: currentFile }, ...this.debugState.callStack]

            this.handleDebugStepCompleted({
                lineNumber: 15,
                variables: {
                    a: 5,
                    b: 7,
                    x: 10,
                    y: 20,
                },
                callStack: newCallStack,
            })
        }, 500)
    }

    stepOut() {
        if (!this.isDebugging || !this.debugState) return

        // Emit step out event
        if (this.socket && this.socket.connected) {
            this.socket.emit("debug-step-out", {
                roomId: this.roomId,
            })
        }

        // For demo purposes, simulate stepping out of a function
        setTimeout(() => {
            const newCallStack = [...this.debugState.callStack]
            if (newCallStack.length > 1) {
                newCallStack.shift() // Remove top frame
            }

            this.handleDebugStepCompleted({
                lineNumber: newCallStack[0].line,
                variables: {
                    x: 10,
                    y: 20,
                    result: 42,
                },
                callStack: newCallStack,
            })
        }, 500)
    }

    continueExecution() {
        if (!this.isDebugging || !this.debugState) return

        // Emit continue event
        if (this.socket && this.socket.connected) {
            this.socket.emit("debug-continue", {
                roomId: this.roomId,
            })
        }

        // Update UI to show we're running
        this.handleDebugContinued()

        // For demo purposes, simulate hitting another breakpoint or finishing
        const fileBreakpoints = Array.from(this.breakpoints.values())
            .filter((bp) => bp.fileName === currentFile && bp.lineNumber > this.debugState.lineNumber)
            .sort((a, b) => a.lineNumber - b.lineNumber)

        setTimeout(() => {
            if (fileBreakpoints.length > 0) {
                // Hit next breakpoint
                const nextBreakpoint = fileBreakpoints[0]
                this.handleDebugPaused({
                    lineNumber: nextBreakpoint.lineNumber,
                    variables: {
                        x: 10,
                        y: 20,
                        result: 50,
                    },
                    callStack: this.debugState.callStack,
                })
            } else {
                // Finished debugging
                this.handleDebugStopped()
            }
        }, 1000)
    }

    handleDebugStarted(data) {
        this.isDebugging = true
        this.updateDebuggerUI(true)
    }

    handleDebugStopped() {
        this.isDebugging = false
        this.updateDebuggerUI(false)
        this.clearDebugState()
    }

    handleDebugPaused(data) {
        if (!this.editor || !monaco) return

        this.debugState = data

        // Highlight the current line
        const decorations = this.editor.deltaDecorations(
            [], [{
                range: new monaco.Range(data.lineNumber, 1, data.lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: "debug-current-line",
                },
            }, ],
        )

        this.debugState.lineDecoration = decorations[0]

        // Update variables display
        this.updateVariablesDisplay(data.variables)

        // Update call stack display
        this.updateCallStackDisplay(data.callStack)

        // Update UI buttons
        document.getElementById("startDebug").setAttribute("disabled", "true")
        document.getElementById("stopDebug").removeAttribute("disabled")
        document.getElementById("stepOver").removeAttribute("disabled")
        document.getElementById("stepInto").removeAttribute("disabled")
        document.getElementById("stepOut").removeAttribute("disabled")
        document.getElementById("continue").removeAttribute("disabled")
    }

    handleDebugContinued() {
        // Clear current line highlight
        if (this.debugState && this.debugState.lineDecoration && this.editor) {
            this.editor.deltaDecorations([this.debugState.lineDecoration], [])
        }

        // Update UI buttons
        document.getElementById("stepOver").setAttribute("disabled", "true")
        document.getElementById("stepInto").setAttribute("disabled", "true")
        document.getElementById("stepOut").setAttribute("disabled", "true")
        document.getElementById("continue").setAttribute("disabled", "true")
    }

    handleDebugStepCompleted(data) {
        if (!this.editor || !monaco) return

        // Clear previous line highlight
        if (this.debugState && this.debugState.lineDecoration) {
            this.editor.deltaDecorations([this.debugState.lineDecoration], [])
        }

        this.debugState = data

        // Highlight the new current line
        const decorations = this.editor.deltaDecorations(
            [], [{
                range: new monaco.Range(data.lineNumber, 1, data.lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: "debug-current-line",
                },
            }, ],
        )

        this.debugState.lineDecoration = decorations[0]

        // Update variables display
        this.updateVariablesDisplay(data.variables)

        // Update call stack display
        this.updateCallStackDisplay(data.callStack)

        // Update UI buttons
        document.getElementById("stepOver").removeAttribute("disabled")
        document.getElementById("stepInto").removeAttribute("disabled")
        document.getElementById("stepOut").removeAttribute("disabled")
        document.getElementById("continue").removeAttribute("disabled")
    }

    updateVariablesDisplay(variables) {
        const variablesList = document.getElementById("variablesList")
        if (!variablesList) return

        variablesList.innerHTML = ""

        for (const [name, value] of Object.entries(variables)) {
            const varElement = document.createElement("div")
            varElement.className = "variable-item"
            varElement.innerHTML = `<span class="variable-name">${name}:</span> <span class="variable-value">${value}</span>`
            variablesList.appendChild(varElement)
        }
    }

    updateCallStackDisplay(callStack) {
        const callStackList = document.getElementById("callStackList")
        if (!callStackList) return

        callStackList.innerHTML = ""

        callStack.forEach((frame, index) => {
            const frameElement = document.createElement("div")
            frameElement.className = "call-stack-item"
            frameElement.innerHTML = `<span class="call-stack-name">${frame.name}</span> <span class="call-stack-location">(${frame.file}:${frame.line})</span>`
            callStackList.appendChild(frameElement)
        })
    }

    updateDebuggerUI(isDebugging) {
        this.isDebugging = isDebugging

        // Update button states
        document.getElementById("startDebug").toggleAttribute("disabled", isDebugging)
        document.getElementById("stopDebug").toggleAttribute("disabled", !isDebugging)

        const stepButtons = ["stepOver", "stepInto", "stepOut", "continue"]
        stepButtons.forEach((id) => {
            document.getElementById(id).toggleAttribute("disabled", !isDebugging || !this.debugState)
        })

        // Show/hide debugger panel
        const debuggerPanel = document.getElementById("debuggerPanel")
        if (debuggerPanel) {
            debuggerPanel.style.display = isDebugging ? "block" : "none"
        }
    }

    clearDebugState() {
        if (this.debugState && this.debugState.lineDecoration && this.editor) {
            this.editor.deltaDecorations([this.debugState.lineDecoration], [])
        }

        this.debugState = null

        // Clear variables and call stack
        const variablesList = document.getElementById("variablesList")
        const callStackList = document.getElementById("callStackList")

        if (variablesList) variablesList.innerHTML = ""
        if (callStackList) callStackList.innerHTML = ""
    }
}

// 4. Voice Chat Integration
class VoiceChat {
    constructor(socket, roomId, username) {
        this.socket = socket
        this.roomId = roomId
        this.username = username
        this.localStream = null
        this.peerConnections = {}
        this.mediaConstraints = {
            audio: true,
            video: false,
        }
        this.configuration = {
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
        }

        this.isMuted = false

        this.init()
    }

    async init() {
        this.setupSocketListeners()
        this.setupUIControls()
    }

    setupSocketListeners() {
        if (!this.socket) return

        // Handle signaling for WebRTC
        this.socket.on("voice-user-joined", async(data) => {
            console.log("Voice user joined:", data.socketId)
            await this.createPeerConnection(data.socketId)
        })

        this.socket.on("voice-user-left", (data) => {
            console.log("Voice user left:", data.socketId)
            this.closePeerConnection(data.socketId)
        })

        this.socket.on("voice-offer", async(data) => {
            console.log("Received voice offer from:", data.socketId)
            await this.handleOffer(data.socketId, data.offer)
        })

        this.socket.on("voice-answer", async(data) => {
            console.log("Received voice answer from:", data.socketId)
            await this.handleAnswer(data.socketId, data.answer)
        })

        this.socket.on("voice-ice-candidate", async(data) => {
            console.log("Received ICE candidate from:", data.socketId)
            await this.handleIceCandidate(data.socketId, data.candidate)
        })
    }

    setupUIControls() {
        const toggleVoiceChatBtn = document.getElementById("toggleVoiceChat")
        const muteAudioBtn = document.getElementById("muteAudio")
        const volumeSlider = document.getElementById("volumeSlider")
        const closeVoiceChatBtn = document.getElementById("closeVoiceChat")

        if (toggleVoiceChatBtn) {
            toggleVoiceChatBtn.addEventListener("click", () => {
                const voiceChatPanel = document.getElementById("voiceChatPanel")
                if (voiceChatPanel) {
                    const isOpen = voiceChatPanel.classList.toggle("open")
                    if (isOpen && !this.localStream) {
                        this.startVoiceChat()
                    }
                }
            })
        }

        if (muteAudioBtn) {
            muteAudioBtn.addEventListener("click", () => {
                this.toggleMute()
            })
        }

        if (volumeSlider) {
            volumeSlider.addEventListener("input", (e) => {
                this.setVolume(e.target.value / 100)
            })
        }

        if (closeVoiceChatBtn) {
            closeVoiceChatBtn.addEventListener("click", () => {
                const voiceChatPanel = document.getElementById("voiceChatPanel")
                if (voiceChatPanel) {
                    voiceChatPanel.classList.remove("open")
                }
                this.stopVoiceChat()
            })
        }
    }

    async startVoiceChat() {
        try {
            // Request microphone access
            this.localStream = await navigator.mediaDevices.getUserMedia(this.mediaConstraints)

            // Notify server that we've joined voice chat
            if (this.socket && this.socket.connected) {
                this.socket.emit("voice-join", {
                    roomId: this.roomId,
                    username: this.username,
                })
            }

            // Update UI
            this.updateVoiceChatUI(true)

            // Add local user to voice chat users list
            this.addVoiceChatUser(this.username, true)

            console.log("Voice chat started")
        } catch (error) {
            console.error("Error starting voice chat:", error)
            alert("Could not access microphone. Please check permissions.")
        }
    }

    stopVoiceChat() {
        // Stop all tracks in local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach((track) => track.stop())
            this.localStream = null
        }

        // Close all peer connections
        Object.keys(this.peerConnections).forEach((socketId) => {
            this.closePeerConnection(socketId)
        })

        // Notify server that we've left voice chat
        if (this.socket && this.socket.connected) {
            this.socket.emit("voice-leave", {
                roomId: this.roomId,
                username: this.username,
            })
        }

        // Update UI
        this.updateVoiceChatUI(false)

        // Clear voice chat users list
        const voiceChatUsers = document.getElementById("voiceChatUsers")
        if (voiceChatUsers) {
            voiceChatUsers.innerHTML = ""
        }

        console.log("Voice chat stopped")
    }

    toggleMute() {
        if (!this.localStream) return

        const audioTracks = this.localStream.getAudioTracks()
        if (audioTracks.length === 0) return

        this.isMuted = !this.isMuted
        audioTracks[0].enabled = !this.isMuted

        // Update UI
        const muteAudioBtn = document.getElementById("muteAudio")
        if (muteAudioBtn) {
            muteAudioBtn.innerHTML = this.isMuted ?
                '<i class="fas fa-microphone-slash"></i> Unmute' :
                '<i class="fas fa-microphone"></i> Mute'
        }
    }

    setVolume(volume) {
        // Set volume for all audio elements
        document.querySelectorAll(".voice-chat-audio").forEach((audio) => {
            audio.volume = volume
        })
    }

    updateVoiceChatUI(isActive) {
        const toggleVoiceChatBtn = document.getElementById("toggleVoiceChat")
        if (toggleVoiceChatBtn) {
            toggleVoiceChatBtn.classList.toggle("active", isActive)
            toggleVoiceChatBtn.innerHTML = isActive ?
                '<i class="fas fa-microphone"></i>' :
                '<i class="fas fa-microphone-slash"></i>'
        }
    }

    addVoiceChatUser(username, isLocal = false) {
        const voiceChatUsers = document.getElementById("voiceChatUsers")
        if (!voiceChatUsers) return

        // Check if user already exists
        const existingUser = voiceChatUsers.querySelector(`[data-username="${username}"]`)
        if (existingUser) return

        // Create user element
        const userElement = document.createElement("div")
        userElement.className = "voice-chat-user"
        userElement.dataset.username = username

        // Generate color based on username
        const colors = ["#FF5733", "#33FF57", "#3357FF", "#FF33A8", "#33A8FF", "#A833FF", "#FF8333", "#33FFC1"]
        const colorIndex = username.charCodeAt(0) % colors.length
        const userColor = colors[colorIndex]

        userElement.innerHTML = `
            <div class="voice-chat-user-avatar" style="background-color: ${userColor}">
                ${username.charAt(0).toUpperCase()}
            </div>
            <div class="voice-chat-user-name">${username}${isLocal ? " (You)" : ""}</div>
            <div class="voice-chat-user-status">
                <i class="fas fa-microphone"></i>
            </div>
        `

        voiceChatUsers.appendChild(userElement)
    }

    removeVoiceChatUser(username) {
        const voiceChatUsers = document.getElementById("voiceChatUsers")
        if (!voiceChatUsers) return

        const userElement = voiceChatUsers.querySelector(`[data-username="${username}"]`)
        if (userElement) {
            voiceChatUsers.removeChild(userElement)
        }
    }

    async createPeerConnection(socketId) {
        if (this.peerConnections[socketId]) {
            console.log("Peer connection already exists for:", socketId)
            return
        }

        try {
            const peerConnection = new RTCPeerConnection(this.configuration)
            this.peerConnections[socketId] = peerConnection

            // Add local tracks to peer connection
            if (this.localStream) {
                this.localStream.getTracks().forEach((track) => {
                    peerConnection.addTrack(track, this.localStream)
                })
            }

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit("voice-ice-candidate", {
                        roomId: this.roomId,
                        targetSocketId: socketId,
                        candidate: event.candidate,
                    })
                }
            }

            // Handle incoming tracks
            peerConnection.ontrack = (event) => {
                console.log("Received remote track from:", socketId)

                // Create audio element for remote stream
                const audioElement = document.createElement("audio")
                audioElement.srcObject = event.streams[0]
                audioElement.autoplay = true
                audioElement.className = "voice-chat-audio"
                audioElement.dataset.socketId = socketId

                // Set initial volume
                const volumeSlider = document.getElementById("volumeSlider")
                if (volumeSlider) {
                    audioElement.volume = volumeSlider.value / 100
                }

                // Add to document
                document.body.appendChild(audioElement)

                // Update UI to show connected status
                this.updateUserConnectionStatus(socketId, true)
            }

            // Create and send offer
            const offer = await peerConnection.createOffer()
            await peerConnection.setLocalDescription(offer)

            this.socket.emit("voice-offer", {
                roomId: this.roomId,
                targetSocketId: socketId,
                offer: offer,
            })

            console.log("Created peer connection for:", socketId)
            return peerConnection
        } catch (error) {
            console.error("Error creating peer connection:", error)
            return null
        }
    }

    async handleOffer(socketId, offer) {
        try {
            let peerConnection = this.peerConnections[socketId]

            if (!peerConnection) {
                peerConnection = await this.createPeerConnection(socketId)
                if (!peerConnection) return
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))

            const answer = await peerConnection.createAnswer()
            await peerConnection.setLocalDescription(answer)

            this.socket.emit("voice-answer", {
                roomId: this.roomId,
                targetSocketId: socketId,
                answer: answer,
            })

            console.log("Handled offer from:", socketId)
        } catch (error) {
            console.error("Error handling offer:", error)
        }
    }

    async handleAnswer(socketId, answer) {
        try {
            const peerConnection = this.peerConnections[socketId]
            if (!peerConnection) {
                console.error("No peer connection for:", socketId)
                return
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
            console.log("Handled answer from:", socketId)
        } catch (error) {
            console.error("Error handling answer:", error)
        }
    }

    async handleIceCandidate(socketId, candidate) {
        try {
            const peerConnection = this.peerConnections[socketId]
            if (!peerConnection) {
                console.error("No peer connection for:", socketId)
                return
            }

            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            console.log("Added ICE candidate from:", socketId)
        } catch (error) {
            console.error("Error handling ICE candidate:", error)
        }
    }

    closePeerConnection(socketId) {
        const peerConnection = this.peerConnections[socketId]
        if (!peerConnection) return

        // Close the connection
        peerConnection.close()
        delete this.peerConnections[socketId]

        // Remove audio element
        const audioElement = document.querySelector(`.voice-chat-audio[data-socketId="${socketId}"]`)
        if (audioElement) {
            document.body.removeChild(audioElement)
        }

        // Update UI
        this.updateUserConnectionStatus(socketId, false)

        console.log("Closed peer connection with:", socketId)
    }

    updateUserConnectionStatus(socketId, isConnected) {
        // Find username for this socket ID
        const username = this.getUsernameBySocketId(socketId)
        if (!username) return

        const voiceChatUsers = document.getElementById("voiceChatUsers")
        if (!voiceChatUsers) return

        const userElement = voiceChatUsers.querySelector(`[data-username="${username}"]`)
        if (userElement) {
            userElement.classList.toggle("connected", isConnected)

            const statusElement = userElement.querySelector(".voice-chat-user-status")
            if (statusElement) {
                statusElement.innerHTML = isConnected ?
                    '<i class="fas fa-microphone"></i>' :
                    '<i class="fas fa-microphone-slash"></i>'
            }
        }
    }

    getUsernameBySocketId(socketId) {
        // This would need to be implemented based on how you track users in your application
        // For now, return a placeholder
        return `User-${socketId.substring(0, 5)}`
    }
}

// Initialize collaboration features when the editor is ready
function initializeCollaborationFeatures(editor, socket, roomId, username) {
    // Set monaco for global access
    monaco = window.monaco

    // Initialize cursor tracking
    const cursorTracker = new CursorTracker(socket, editor, roomId, username)

    // Initialize code annotations
    const codeAnnotations = new CodeAnnotations(editor, socket, roomId)

    // Initialize collaborative debugging
    const collaborativeDebugging = new CollaborativeDebugging(editor, socket, roomId)

    // Initialize voice chat
    const voiceChat = new VoiceChat(socket, roomId, username)

    return {
        cursorTracker,
        codeAnnotations,
        collaborativeDebugging,
        voiceChat,
    }
}

// Export the initialization function
window.initializeCollaborationFeatures = initializeCollaborationFeatures