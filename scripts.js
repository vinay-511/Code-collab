require.config({
    paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs",
        "socket.io": "https://cdn.socket.io/4.7.2/socket.io.min",
        split: "https://cdnjs.cloudflare.com/ajax/libs/split.js/1.6.5/split.min",
    },
})

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const loginForm = document.getElementById("login-form")
    const loginContainer = document.getElementById("login-container")
    const editorContainer = document.getElementById("editor-container")
    const roomIdGroup = document.getElementById("room-id-group")
    const adminModeToggle = document.getElementById("admin-mode")
    const loginButton = document.getElementById("login-button")
    const changeThemeButton = document.getElementById("changeTheme")
    const userList = document.getElementById("userList")
    const chatPanel = document.getElementById("chatPanel")
    const chatToggle = document.getElementById("chatToggle")
    const chatMessages = document.getElementById("chatMessages")
    const chatInput = document.getElementById("chatInput")
    const sendChatButton = document.getElementById("sendChat")
    const errorMessage = document.getElementById("errorMessage")
    const fileModal = document.getElementById("fileModal")
    const fileNameInput = document.getElementById("fileNameInput")
    const fileTypeInput = document.getElementById("fileTypeInput")
    const fileList = document.getElementById("fileList")
    const runCodeBtn = document.getElementById("runCode")
    const consoleOutput = document.getElementById("consoleOutput")
    const terminalInputSection = document.getElementById("terminalInputSection")
    const terminalInput = document.getElementById("terminalInput")
    const sendInputBtn = document.getElementById("sendInput")
    const annotationsPanel = document.getElementById("annotationsPanel")
    const annotationsList = document.getElementById("annotationsList")
    const addAnnotationBtn = document.getElementById("addAnnotation")
    const toggleAnnotationsBtn = document.getElementById("toggleAnnotations")
    const terminalContainer = document.getElementById("terminalContainer")
    const addTerminalBtn = document.getElementById("addTerminal")
    const terminalTabs = document.getElementById("terminalTabs")
    const terminalThemeSelect = document.getElementById("terminalTheme")
    const shellSelect = document.getElementById("shellSelect")
    const toggleVoiceChatBtn = document.getElementById("toggleVoiceChat")
    const voiceChatPanel = document.getElementById("voiceChatPanel")
    const voiceChatUsers = document.getElementById("voiceChatUsers")
    const debugPanel = document.getElementById("debugPanel")
    const toggleDebugBtn = document.getElementById("toggleDebug")
    const breakpointsList = document.getElementById("breakpointsList")
    const debugControls = document.getElementById("debugControls")

    // State variables
    let editor
    let socket
    let currentUsername
    let currentRoomId
    const openFiles = {}
    let currentFile = null
    let isDarkTheme = true
    let isEditorInitialized = false
    let isEditorReady = false
    const pendingCodeUpdates = {}
    let isProcessingRemoteUpdate = false
    const lastSentCode = {} // Track last sent code to avoid duplicate updates
    const serverPublicUrl = "" // Store the public URL
    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    let connectionStatus = "disconnected"
    const isExecuting = false
    let fileOwners = {} // Track file owners: fileName -> {socketId, username}
    let currentSocketId = null // Store current user's socket ID
    const rooms = {}
    const hasEditPermission = {} // Track edit permissions for files
    let folderStructure = { "/": [] } // Track folder structure
    let filePermissions = {} // Track file permissions
    let isWaitingForInput = false // Track if code execution is waiting for input
    let currentExecutionLanguage = null // Track current execution language
    let currentExecutionCode = null // Track current execution code
    let inputBuffer = "" // Buffer for user input

    // Cursor tracking
    const remoteCursors = {} // Track remote cursors: socketId -> {position, username, color}
    const userColors = {} // Track user colors: username -> color

    // Voice chat
    let localStream = null
    let peerConnections = {} // Track peer connections: socketId -> RTCPeerConnection
    let isVoiceChatActive = false

    // Code annotations
    let annotations = {} // Track annotations: fileName -> lineNumber -> [{text, author, timestamp}]

    // Debugging
    let breakpoints = {} // Track breakpoints: fileName -> [lineNumbers]
    const isDebugging = false
    const debugState = null

    // Terminal
    const terminals = [] // Track terminal instances
    let activeTerminal = 0
    const terminalHistory = {} // Track terminal history: terminalId -> [commands]
    let terminalTheme = "dark"
    let selectedShell = "bash"

    // Show a loading indicator while fetching server info
    const loadingIndicator = document.createElement("div")
    loadingIndicator.className = "loading-indicator"
    loadingIndicator.innerHTML = `
        <div class="spinner"></div>
        <p>Connecting to server...</p>
      `
    document.body.appendChild(loadingIndicator)

    // Fetch server info including public URL
    fetchServerInfo()

    // Improved function to run code with JDoodle via our server.js
    async function runCodeWithJDoodle(language, code, stdin = "") {
        try {
            // Use the correct URL for the JDoodle backend
            const jdoodleBackendUrl = `${window.location.origin}/api/execute`

            console.log(`Sending code execution request to: ${jdoodleBackendUrl}`)
            consoleOutput.innerHTML = `<div class="running">Running ${language} code...</div>`

            // Store current execution details
            currentExecutionLanguage = language
            currentExecutionCode = code

            const response = await fetch(jdoodleBackendUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    script: code,
                    language: getJDoodleLanguage(language),
                    stdin: stdin,
                }),
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Server responded with status: ${response.status}. ${errorText}`)
            }

            const result = await response.json()

            if (result.success && result.output) {
                // Check if the output indicates waiting for input
                if (result.output.includes("EOF") || result.output.includes("waiting for input")) {
                    isWaitingForInput = true
                    showTerminalInput()
                    return `${result.output.trim()}\n<div class="input-waiting">Waiting for input...</div>`
                }

                isWaitingForInput = false
                hideTerminalInput()
                return result.output.trim()
            }
            if (result.error) {
                isWaitingForInput = false
                hideTerminalInput()
                return `Error: ${result.error}`
            }
            isWaitingForInput = false
            hideTerminalInput()
            return "Execution completed with no output."
        } catch (error) {
            console.error("Error executing code:", error)
            isWaitingForInput = false
            hideTerminalInput()
            return `Error: ${error.message}`
        }
    }

    // Function to show terminal input
    function showTerminalInput() {
        if (terminalInputSection) {
            terminalInputSection.style.display = "flex"
            terminalInput.focus()
        }
    }

    // Function to hide terminal input
    function hideTerminalInput() {
        if (terminalInputSection) {
            terminalInputSection.style.display = "none"
        }
    }

    // Function to send terminal input
    function sendTerminalInput() {
        if (!terminalInput || !isWaitingForInput) return

        const input = terminalInput.value
        inputBuffer += input + "\n"

        // Add to terminal history
        if (terminals[activeTerminal]) {
            const terminalId = terminals[activeTerminal].id
            if (!terminalHistory[terminalId]) {
                terminalHistory[terminalId] = []
            }
            terminalHistory[terminalId].push(input)

            // Emit terminal history update
            if (socket && socket.connected) {
                socket.emit("terminal-history-update", {
                    roomId: currentRoomId,
                    terminalId: terminalId,
                    history: terminalHistory[terminalId],
                })
            }
        }

        // Display the input in the console
        const inputDisplay = document.createElement("div")
        inputDisplay.innerHTML = `<span style="color: var(--accent-primary);">$ ${input}</span>`
        consoleOutput.appendChild(inputDisplay)

        // Clear the input field
        terminalInput.value = ""

        // Re-run the code with the input
        if (currentExecutionLanguage && currentExecutionCode) {
            runCodeWithJDoodle(currentExecutionLanguage, currentExecutionCode, inputBuffer).then((output) => {
                consoleOutput.innerHTML = output
            })
        }
    }

    // Helper function to map file extensions to JDoodle language identifiers
    function getJDoodleLanguage(fileExtension) {
        const languageMap = {
            js: "nodejs",
            py: "python3",
            java: "java",
            c: "c",
            cpp: "cpp14",
            cs: "csharp",
            php: "php",
            rb: "ruby",
            go: "go",
            rs: "rust",
        }

        // Extract extension without the dot
        const ext = fileExtension.startsWith(".") ? fileExtension.substring(1) : fileExtension

        return languageMap[ext] || ext
    }

    // Function to execute JavaScript directly
    function runJavaScript(code) {
        const logBuffer = []
        const originalConsoleLog = console.log

        console.log = (...args) => {
            logBuffer.push(args.join(" "))
            originalConsoleLog.apply(console, args)
        }

        try {
            new Function(code)()
            return logBuffer.length ? logBuffer.join("\n") : "Executed successfully."
        } catch (error) {
            return `Error: ${error.message}`
        } finally {
            console.log = originalConsoleLog
        }
    }

    function fetchServerInfo() {
        console.log("Fetching server info...")
            // Remove loading indicator and show login
        document.body.removeChild(loadingIndicator)
        if (loginContainer) {
            loginContainer.classList.remove("hidden")
        }
        if (editorContainer) {
            editorContainer.classList.add("hidden")
        }
    }

    // Theme switching function
    function toggleTheme() {
        isDarkTheme = !isDarkTheme
        document.body.classList.toggle("dark", isDarkTheme)
        applyTheme()
    }

    function applyTheme() {
        document.body.classList.toggle("light", !isDarkTheme)
        if (editor && window.monaco) {
            window.monaco.editor.setTheme(isDarkTheme ? "vs-dark" : "vs-light")
        }
        if (changeThemeButton) {
            changeThemeButton.textContent = isDarkTheme ? "Light Theme" : "Dark Theme"
        }

        // Apply theme to terminals
        applyTerminalTheme(terminalTheme)

        // Apply theme-specific styles
        document.documentElement.style.setProperty("--text-primary", isDarkTheme ? "#ffffff" : "#333333")
        document.documentElement.style.setProperty("--text-secondary", isDarkTheme ? "#b0b0b0" : "#666666")
        document.documentElement.style.setProperty("--bg-primary", isDarkTheme ? "#1a1a1a" : "#ffffff")
        document.documentElement.style.setProperty("--bg-secondary", isDarkTheme ? "#2a2a2a" : "#f0f0f0")
        document.documentElement.style.setProperty("--border-color", isDarkTheme ? "#3f3f3f" : "#e0e0e0")
    }

    // Admin mode toggle
    if (adminModeToggle && roomIdGroup) {
        adminModeToggle.addEventListener("change", () => {
            roomIdGroup.style.display = adminModeToggle.checked ? "none" : "block"
            loginButton.textContent = adminModeToggle.checked ? "Create Room" : "Join Room"
        })
    }

    // Handle login form submission
    if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
            e.preventDefault()
            const username = document.getElementById("username").value
            const password = document.getElementById("password").value
            const isAdmin = adminModeToggle && adminModeToggle.checked
            let roomId

            if (isAdmin) {
                roomId = generateRoomId()
                console.log(`Creating room: ${roomId} as ${username}`)
            } else {
                const roomIdElement = document.getElementById("room-id")
                roomId = roomIdElement ? roomIdElement.value : ""
                console.log(`Joining room: ${roomId} as ${username}`)
            }

            // Hide login, show editor
            if (loginContainer) loginContainer.classList.add("hidden")
            if (editorContainer) editorContainer.classList.remove("hidden")

            // Initialize the editor without creating a file
            initializeEditor()
            initializeWebSocket(roomId, username, password, isAdmin)

            // Initialize voice chat
            initializeVoiceChat()

            // Initialize terminal
            initializeTerminals()
        })
    }

    function generateRoomId() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        let result = ""
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        return result
    }

    function addUser(username) {
        if (!userList) return

        // Check if user already exists in the list
        const existingUsers = Array.from(userList.children).map((avatar) => avatar.title)
        if (existingUsers.includes(username)) {
            return
        }

        // Generate a random color for the user
        const colors = ["#FF5733", "#33FF57", "#3357FF", "#FF33A8", "#33A8FF", "#A833FF", "#FF8333", "#33FFC1"]
        const colorIndex = username.charCodeAt(0) % colors.length
        const userColor = colors[colorIndex]

        // Store the user's color
        userColors[username] = userColor

        const userAvatar = document.createElement("div")
        userAvatar.className = "user-avatar"
        userAvatar.textContent = username.charAt(0).toUpperCase()
        userAvatar.title = username
        userAvatar.style.backgroundColor = userColor

        userList.appendChild(userAvatar)

        // Show notification for new user
        if (username !== currentUsername) {
            showUserJoinedNotification(username)
        }
    }

    function showUserJoinedNotification(username) {
        showNotification(`${username} joined the room`, "info", "👋")
    }

    function showNotification(message, type = "info", icon = "ℹ️") {
        const notification = document.createElement("div")
        notification.className = `notification ${type}`
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">${icon}</div>
                <div class="notification-text">${message}</div>
            </div>
          `
        document.body.appendChild(notification)

        // Show the notification
        setTimeout(() => {
            notification.classList.add("show")
        }, 100)

        // Remove after 5 seconds
        setTimeout(() => {
            notification.classList.remove("show")
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification)
                }
            }, 300)
        }, 5000)
    }

    // Function to show permission request modal
    function showPermissionRequestModal(fileName, requesterName, requesterSocketId) {
        // Create modal if it doesn't exist
        let permissionModal = document.getElementById("permissionModal")
        if (!permissionModal) {
            permissionModal = document.createElement("div")
            permissionModal.id = "permissionModal"
            permissionModal.className = "modal"

            const modalContent = document.createElement("div")
            modalContent.className = "modal-content"

            modalContent.innerHTML = `
                <h3>Permission Request</h3>
                <p id="permissionMessage"></p>
                <div>
                    <button id="approvePermission" class="btn-primary">Approve</button>
                    <button id="denyPermission" class="btn-secondary">Deny</button>
                </div>
              `

            permissionModal.appendChild(modalContent)
            document.body.appendChild(permissionModal)
        }

        // Set message and show modal
        const permissionMessage = document.getElementById("permissionMessage")
        permissionMessage.textContent = `${requesterName} is requesting permission to edit "${fileName}"`

        // Store data for the buttons
        permissionModal.dataset.fileName = fileName
        permissionModal.dataset.requesterName = requesterName
        permissionModal.dataset.requesterSocketId = requesterSocketId

        // Show the modal
        permissionModal.style.display = "block"

        // Set up button handlers
        document.getElementById("approvePermission").onclick = () => {
            respondToPermissionRequest(true)
        }

        document.getElementById("denyPermission").onclick = () => {
            respondToPermissionRequest(false)
        }
    }

    // Function to respond to permission request
    function respondToPermissionRequest(approved) {
        const permissionModal = document.getElementById("permissionModal")
        const fileName = permissionModal.dataset.fileName
        const requesterName = permissionModal.dataset.requesterName
        const requesterSocketId = permissionModal.dataset.requesterSocketId

        if (socket && socket.connected && requesterSocketId) {
            socket.emit("respond-to-permission", {
                roomId: currentRoomId,
                fileName: fileName,
                requesterSocketId: requesterSocketId,
                approved: approved,
            })

            // Show notification
            showNotification(
                `Permission ${approved ? "granted" : "denied"} for ${requesterName} to edit ${fileName}`,
                approved ? "success" : "info",
            )
        }

        // Hide the modal
        permissionModal.style.display = "none"
    }

    function initializeEditor() {
        require(["vs/editor/editor.main"], () => {
            // Monaco editor is now available
            const monaco = window.monaco

            const fileList = document.getElementById("fileList")
            const fileModal = document.getElementById("fileModal")
            const fileNameInput = document.getElementById("fileNameInput")
            const fileTypeInput = document.getElementById("fileTypeInput")
            const errorMessage = document.getElementById("errorMessage")
            const editorContainer = document.getElementById("editorContainer")

            if (!fileList || !fileModal || !fileNameInput || !fileTypeInput || !errorMessage || !editorContainer) {
                console.error("Required DOM elements not found for editor initialization")
                return
            }

            function createEditor(fileName, fileType) {
                if (editor) {
                    editor.dispose()
                }

                const fullFileName = `${fileName}${fileType}`

                // Check if we have permission to edit this file
                const canEdit = hasEditPermission[fullFileName] === true

                editor = monaco.editor.create(editorContainer, {
                    value: openFiles[fullFileName].content || getDefaultContent(fileType),
                    language: getLanguage(fileType),
                    theme: isDarkTheme ? "vs-dark" : "vs-light",
                    automaticLayout: true,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: "on",
                    renderLineHighlight: "all",
                    cursorBlinking: "blink",
                    cursorSmoothCaretAnimation: "on",
                    readOnly: !canEdit, // Set read-only based on permission
                })

                console.log(`Creating editor for ${fullFileName}, readOnly: ${!canEdit}`)

                // Set up change event handler with debounce
                let debounceTimeout
                editor.onDidChangeModelContent((e) => {
                    if (currentFile && isEditorReady && !isProcessingRemoteUpdate) {
                        const newCode = editor.getValue()
                        openFiles[currentFile].content = newCode

                        // Clear any existing timeout
                        clearTimeout(debounceTimeout)

                        // Set a new timeout to emit the change after a short delay
                        debounceTimeout = setTimeout(() => {
                                // Only emit if the code has actually changed from what we last sent
                                if (!lastSentCode[currentFile] || lastSentCode[currentFile] !== newCode) {
                                    // Emit code change to server
                                    if (socket && socket.connected) {
                                        console.log(`Emitting code change for ${currentFile}`)
                                        socket.emit("code-change", {
                                                roomId: currentRoomId,
                                                fileName: currentFile,
                                                code: newCode,
                                            })
                                            // Update the last sent code
                                        lastSentCode[currentFile] = newCode
                                    }
                                }
                            }, 300) // 300ms debounce
                    }
                })

                // Set up cursor position change event for real-time cursor tracking
                editor.onDidChangeCursorPosition((e) => {
                    if (currentFile && isEditorReady && !isProcessingRemoteUpdate && socket && socket.connected) {
                        socket.emit("cursor-position", {
                            roomId: currentRoomId,
                            fileName: currentFile,
                            position: {
                                lineNumber: e.position.lineNumber,
                                column: e.position.column,
                            },
                        })
                    }
                })

                // Set up mouse down event for breakpoints
                editor.onMouseDown((e) => {
                    // Check if click is in the gutter area (line numbers)
                    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
                        toggleBreakpoint(currentFile, e.target.position.lineNumber)
                    }
                })

                currentFile = fullFileName
                isEditorReady = true

                // Add animation when switching files
                editorContainer.style.opacity = "0"
                setTimeout(() => {
                    editorContainer.style.opacity = "1"
                }, 50)

                isEditorInitialized = true

                // Apply any pending updates for this file
                if (pendingCodeUpdates[fullFileName]) {
                    isProcessingRemoteUpdate = true
                    editor.setValue(pendingCodeUpdates[fullFileName])
                    isProcessingRemoteUpdate = false
                    delete pendingCodeUpdates[fullFileName]
                }

                // Update the document title to include the file name
                document.title = `CodeCollab - ${fullFileName}`

                // Update file owner indicator
                updateFileOwnerIndicator(fullFileName)

                // Load annotations for this file
                loadAnnotations(fullFileName)

                // Load breakpoints for this file
                renderBreakpoints(fullFileName)
            }

            function getLanguage(fileType) {
                const languageMap = {
                    ".html": "html",
                    ".css": "css",
                    ".js": "javascript",
                    ".py": "python",
                    ".java": "java",
                    ".json": "json",
                    ".md": "markdown",
                    ".txt": "plaintext",
                    ".ts": "typescript",
                    ".jsx": "javascript",
                    ".tsx": "typescript",
                    ".c": "c",
                }
                return languageMap[fileType] || "plaintext"
            }

            function getDefaultContent(fileType) {
                const contentMap = {
                    ".html": '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n</head>\n<body>\n    \n</body>\n</html>',
                    ".css": "/* Write your CSS here */",
                    ".js": "// Write your JavaScript here",
                    ".py": "# Write your Python code here",
                    ".java": 'public class Main {\n    public static void main(String[] args) {\n        // Write your Java code here\n        System.out.println("Hello, World!");\n    }\n}',
                    ".c": '#include <stdio.h>\n\nint main() {\n    // Write your C code here\n    printf("Hello, World!\\n");\n    return 0;\n}',
                }
                return contentMap[fileType] || ""
            }

            function loadFile(fileName, fileType) {
                isEditorReady = false
                createEditor(fileName, fileType)
                updateFileList()
            }

            function updateFileList() {
                fileList.innerHTML = ""

                // Create folder structure in the file list
                const folderElements = {}
                folderElements["/"] = fileList

                // First create all folder elements
                Object.keys(folderStructure).forEach((folderPath) => {
                    if (folderPath === "/") return

                    const parts = folderPath.split("/").filter(Boolean)
                    let currentPath = "/"
                    let parentElement = folderElements["/"]

                    for (const part of parts) {
                        currentPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`

                        if (!folderElements[currentPath]) {
                            // Create folder element if it doesn't exist
                            const folderItem = document.createElement("li")
                            folderItem.className = "folder-list-item"

                            const folderIcon = document.createElement("span")
                            folderIcon.className = "folder-icon"
                            folderIcon.innerHTML = "📁"
                            folderItem.appendChild(folderIcon)

                            const folderName = document.createElement("span")
                            folderName.textContent = part
                            folderName.className = "folder-name"
                            folderItem.appendChild(folderName)

                            const folderContent = document.createElement("ul")
                            folderContent.className = "folder-content"
                            folderItem.appendChild(folderContent)

                            // Add click handler to toggle folder
                            folderItem.addEventListener("click", (e) => {
                                if (e.target === folderItem || e.target === folderIcon || e.target === folderName) {
                                    folderContent.classList.toggle("expanded")
                                    folderIcon.innerHTML = folderContent.classList.contains("expanded") ? "📂" : "📁"
                                    e.stopPropagation()
                                }
                            })

                            parentElement.appendChild(folderItem)
                            folderElements[currentPath] = folderContent
                        }

                        parentElement = folderElements[currentPath]
                    }
                })

                // Now add files to their respective folders
                Object.keys(openFiles).forEach((file) => {
                    // Find which folder this file belongs to
                    let fileFolder = "/"
                    for (const folderPath in folderStructure) {
                        if (folderStructure[folderPath].includes(file)) {
                            fileFolder = folderPath
                            break
                        }
                    }

                    const parentElement = folderElements[fileFolder]

                    const listItem = document.createElement("li")
                    listItem.className = "file-list-item"

                    // Create file name element
                    const fileNameSpan = document.createElement("span")
                    fileNameSpan.textContent = file
                    fileNameSpan.className = "file-name"
                    listItem.appendChild(fileNameSpan)

                    // Add owner badge if available
                    if (fileOwners[file]) {
                        const ownerBadge = document.createElement("span")
                        ownerBadge.className = "owner-badge"
                        ownerBadge.title = `Created by: ${fileOwners[file].username}`
                        ownerBadge.textContent = fileOwners[file].username.charAt(0).toUpperCase()
                        listItem.appendChild(ownerBadge)
                    }

                    // Add annotation indicator if file has annotations
                    if (annotations[file] && Object.keys(annotations[file]).length > 0) {
                        const annotationBadge = document.createElement("span")
                        annotationBadge.className = "annotation-badge"
                        annotationBadge.title = `${Object.keys(annotations[file]).length} annotations`
                        annotationBadge.textContent = Object.keys(annotations[file]).length
                        listItem.appendChild(annotationBadge)
                    }

                    // Add breakpoint indicator if file has breakpoints
                    if (breakpoints[file] && breakpoints[file].length > 0) {
                        const breakpointBadge = document.createElement("span")
                        breakpointBadge.className = "breakpoint-badge"
                        breakpointBadge.title = `${breakpoints[file].length} breakpoints`
                        breakpointBadge.textContent = breakpoints[file].length
                        listItem.appendChild(breakpointBadge)
                    }

                    // Add delete button with improved styling
                    const isOwner = fileOwners[file] && fileOwners[file].socketId === currentSocketId
                    const isAdmin = rooms && rooms[currentRoomId] && rooms[currentRoomId].adminSocketId === currentSocketId

                    if (isOwner || isAdmin) {
                        const deleteBtn = document.createElement("button")
                        deleteBtn.className = "file-delete-btn"
                        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>'
                        deleteBtn.title = "Delete file"
                        deleteBtn.onclick = (e) => {
                            e.stopPropagation()
                            deleteFile(file)
                        }
                        listItem.appendChild(deleteBtn)
                    }

                    listItem.addEventListener("click", () => {
                        const fileNameWithoutExt = file.substring(0, file.lastIndexOf("."))
                        const fileExt = file.substring(file.lastIndexOf("."))
                        loadFile(fileNameWithoutExt, fileExt)
                    })
                    if (file === currentFile) {
                        listItem.classList.add("active")
                    }
                    parentElement.appendChild(listItem)
                })
            }

            // Function to update file owner indicator
            function updateFileOwnerIndicator(fileName) {
                const fileOwnerIndicator = document.getElementById("fileOwnerIndicator") || document.createElement("div")

                fileOwnerIndicator.id = "fileOwnerIndicator"
                fileOwnerIndicator.className = "file-owner-indicator"

                if (fileOwners[fileName]) {
                    const isOwner = fileOwners[fileName].socketId === currentSocketId
                    const isAdmin = rooms[currentRoomId] && rooms[currentRoomId].adminSocketId === currentSocketId

                    // Update edit permission status
                    hasEditPermission[fileName] =
                        isOwner ||
                        isAdmin ||
                        (filePermissions[currentRoomId] &&
                            filePermissions[currentRoomId][fileName] &&
                            filePermissions[currentRoomId][fileName][currentSocketId] === "approved")

                    // Update the editor's read-only state if it exists
                    if (editor && currentFile === fileName) {
                        console.log(`Updating editor read-only state for ${fileName}: ${!hasEditPermission[fileName]}`)
                        editor.updateOptions({ readOnly: !hasEditPermission[fileName] })
                    }

                    fileOwnerIndicator.innerHTML = isOwner ?
                        `<span class="owner-badge">You are the owner</span>` :
                        `<span class="owner-badge">Owner: ${fileOwners[fileName].username}</span>`

                    // Add request permission button if not the owner and don't have permission
                    if (!isOwner && !hasEditPermission[fileName] && !isAdmin) {
                        const requestBtn = document.createElement("button")
                        requestBtn.className = "request-permission-btn"
                        requestBtn.textContent = "Request Edit Permission"
                        requestBtn.onclick = () => {
                            requestFilePermission(fileName)
                        }
                        fileOwnerIndicator.appendChild(requestBtn)
                    } else if (!isOwner && hasEditPermission[fileName]) {
                        // Show that user has permission
                        const permissionBadge = document.createElement("span")
                        permissionBadge.className = "permission-badge"
                        permissionBadge.textContent = "You have edit permission"
                        fileOwnerIndicator.appendChild(permissionBadge)
                    }
                } else {
                    fileOwnerIndicator.innerHTML = `<span class="owner-badge">No owner assigned</span>`
                }

                // Add to toolbar if not already there
                const toolbar = document.querySelector(".toolbar")
                if (toolbar && !document.getElementById("fileOwnerIndicator")) {
                    toolbar.appendChild(fileOwnerIndicator)
                }
            }

            // Function to request file permission
            function requestFilePermission(fileName) {
                if (socket && socket.connected) {
                    socket.emit("request-file-permission", {
                        roomId: currentRoomId,
                        fileName: fileName,
                    })

                    showNotification(`Requesting permission to edit ${fileName}...`, "info")
                }
            }

            // Function to delete a file
            function deleteFile(fileName) {
                if (confirm(`Are you sure you want to delete ${fileName}?`)) {
                    if (socket && socket.connected) {
                        socket.emit("delete-file", {
                            roomId: currentRoomId,
                            fileName: fileName,
                        })
                    }
                }
            }

            // Function to toggle breakpoint
            function toggleBreakpoint(fileName, lineNumber) {
                if (!breakpoints[fileName]) {
                    breakpoints[fileName] = []
                }

                const index = breakpoints[fileName].indexOf(lineNumber)
                if (index === -1) {
                    // Add breakpoint
                    breakpoints[fileName].push(lineNumber)
                } else {
                    // Remove breakpoint
                    breakpoints[fileName].splice(index, 1)
                }

                // Update breakpoint decorations in editor
                renderBreakpoints(fileName)

                // Emit breakpoint update to server
                if (socket && socket.connected) {
                    socket.emit("breakpoint-update", {
                        roomId: currentRoomId,
                        fileName: fileName,
                        breakpoints: breakpoints[fileName],
                    })
                }
            }

            // Function to render breakpoints in editor
            function renderBreakpoints(fileName) {
                if (!editor || currentFile !== fileName) return

                // Clear existing breakpoint decorations
                const oldDecorations = editor
                    .getModel()
                    .getAllDecorations()
                    .filter((d) => d.options.glyphMarginClassName === "breakpoint-glyph")
                    .map((d) => d.id)

                // Create new decorations for breakpoints
                const newDecorations = []
                if (breakpoints[fileName]) {
                    breakpoints[fileName].forEach((lineNumber) => {
                        newDecorations.push({
                            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                            options: {
                                isWholeLine: false,
                                glyphMarginClassName: "breakpoint-glyph",
                                glyphMarginHoverMessage: { value: "Breakpoint" },
                            },
                        })
                    })
                }

                // Apply decorations
                editor.deltaDecorations(oldDecorations, newDecorations)

                // Update breakpoints list in debug panel
                updateBreakpointsList()
            }

            // Function to update breakpoints list in debug panel
            function updateBreakpointsList() {
                if (!breakpointsList) return

                breakpointsList.innerHTML = ""

                let hasBreakpoints = false
                Object.keys(breakpoints).forEach((file) => {
                    if (breakpoints[file] && breakpoints[file].length > 0) {
                        hasBreakpoints = true
                        const fileItem = document.createElement("div")
                        fileItem.className = "debug-file-item"

                        const fileHeader = document.createElement("div")
                        fileHeader.className = "debug-file-header"
                        fileHeader.textContent = file
                        fileItem.appendChild(fileHeader)

                        const breakpointItems = document.createElement("div")
                        breakpointItems.className = "debug-breakpoint-items"

                        breakpoints[file].forEach((line) => {
                            const breakpointItem = document.createElement("div")
                            breakpointItem.className = "debug-breakpoint-item"
                            breakpointItem.innerHTML = `Line ${line} <button class="remove-breakpoint" data-file="${file}" data-line="${line}">×</button>`
                            breakpointItems.appendChild(breakpointItem)
                        })

                        fileItem.appendChild(breakpointItems)
                        breakpointsList.appendChild(fileItem)
                    }
                })

                if (!hasBreakpoints) {
                    breakpointsList.innerHTML = '<div class="no-breakpoints">No breakpoints set</div>'
                }

                // Add event listeners to remove buttons
                document.querySelectorAll(".remove-breakpoint").forEach((btn) => {
                    btn.addEventListener("click", (e) => {
                        const file = e.target.dataset.file
                        const line = Number.parseInt(e.target.dataset.line)
                        toggleBreakpoint(file, line)
                    })
                })
            }

            // Function to add annotation
            function addAnnotation(fileName, lineNumber, text) {
                if (!annotations[fileName]) {
                    annotations[fileName] = {}
                }

                if (!annotations[fileName][lineNumber]) {
                    annotations[fileName][lineNumber] = []
                }

                const annotation = {
                    text: text,
                    author: currentUsername,
                    timestamp: new Date().toISOString(),
                }

                annotations[fileName][lineNumber].push(annotation)

                // Emit annotation update to server
                if (socket && socket.connected) {
                    socket.emit("annotation-update", {
                        roomId: currentRoomId,
                        fileName: fileName,
                        lineNumber: lineNumber,
                        annotation: annotation,
                    })
                }

                // Update annotations in editor
                renderAnnotations(fileName)
            }

            // Function to load annotations for a file
            function loadAnnotations(fileName) {
                if (!annotationsList) return

                annotationsList.innerHTML = ""

                if (annotations[fileName]) {
                    const lineNumbers = Object.keys(annotations[fileName]).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))

                    if (lineNumbers.length === 0) {
                        annotationsList.innerHTML = '<div class="no-annotations">No annotations for this file</div>'
                        return
                    }

                    lineNumbers.forEach((lineNumber) => {
                        const lineAnnotations = annotations[fileName][lineNumber]

                        lineAnnotations.forEach((annotation) => {
                            const annotationItem = document.createElement("div")
                            annotationItem.className = "annotation-item"

                            const annotationHeader = document.createElement("div")
                            annotationHeader.className = "annotation-header"

                            const lineLink = document.createElement("a")
                            lineLink.href = "#"
                            lineLink.className = "annotation-line-link"
                            lineLink.textContent = `Line ${lineNumber}`
                            lineLink.onclick = (e) => {
                                e.preventDefault()
                                if (editor && currentFile === fileName) {
                                    editor.revealLineInCenter(Number.parseInt(lineNumber))
                                    editor.setPosition({
                                        lineNumber: Number.parseInt(lineNumber),
                                        column: 1,
                                    })
                                    editor.focus()
                                }
                            }

                            annotationHeader.appendChild(lineLink)

                            const authorSpan = document.createElement("span")
                            authorSpan.className = "annotation-author"
                            authorSpan.textContent = annotation.author
                            annotationHeader.appendChild(authorSpan)

                            const timeSpan = document.createElement("span")
                            timeSpan.className = "annotation-time"
                            timeSpan.textContent = new Date(annotation.timestamp).toLocaleTimeString()
                            annotationHeader.appendChild(timeSpan)

                            annotationItem.appendChild(annotationHeader)

                            const annotationText = document.createElement("div")
                            annotationText.className = "annotation-text"
                            annotationText.textContent = annotation.text
                            annotationItem.appendChild(annotationText)

                            // Add delete button if current user is the author
                            if (annotation.author === currentUsername) {
                                const deleteBtn = document.createElement("button")
                                deleteBtn.className = "delete-annotation"
                                deleteBtn.innerHTML = "×"
                                deleteBtn.title = "Delete annotation"
                                deleteBtn.onclick = () => deleteAnnotation(fileName, lineNumber, annotation)
                                annotationItem.appendChild(deleteBtn)
                            }

                            annotationsList.appendChild(annotationItem)
                        })
                    })
                } else {
                    annotationsList.innerHTML = '<div class="no-annotations">No annotations for this file</div>'
                }
            }

            // Function to delete annotation
            function deleteAnnotation(fileName, lineNumber, annotation) {
                if (!annotations[fileName] || !annotations[fileName][lineNumber]) return

                const index = annotations[fileName][lineNumber].findIndex(
                    (a) => a.text === annotation.text && a.author === annotation.author && a.timestamp === annotation.timestamp,
                )

                if (index !== -1) {
                    annotations[fileName][lineNumber].splice(index, 1)

                    // If no more annotations for this line, remove the line entry
                    if (annotations[fileName][lineNumber].length === 0) {
                        delete annotations[fileName][lineNumber]
                    }

                    // If no more annotations for this file, remove the file entry
                    if (Object.keys(annotations[fileName]).length === 0) {
                        delete annotations[fileName]
                    }

                    // Emit annotation delete to server
                    if (socket && socket.connected) {
                        socket.emit("annotation-delete", {
                            roomId: currentRoomId,
                            fileName: fileName,
                            lineNumber: lineNumber,
                            annotation: annotation,
                        })
                    }

                    // Update annotations in editor
                    renderAnnotations(fileName)
                    loadAnnotations(fileName)
                }
            }

            // Function to render annotations in editor
            function renderAnnotations(fileName) {
                if (!editor || currentFile !== fileName) return

                // Clear existing annotation decorations
                const oldDecorations = editor
                    .getModel()
                    .getAllDecorations()
                    .filter((d) => d.options.className === "annotated-line")
                    .map((d) => d.id)

                // Create new decorations for annotations
                const newDecorations = []
                if (annotations[fileName]) {
                    Object.keys(annotations[fileName]).forEach((lineNumber) => {
                        if (annotations[fileName][lineNumber].length > 0) {
                            newDecorations.push({
                                range: new monaco.Range(Number.parseInt(lineNumber), 1, Number.parseInt(lineNumber), 1),
                                options: {
                                    isWholeLine: true,
                                    className: "annotated-line",
                                    glyphMarginClassName: "annotation-glyph",
                                    hoverMessage: { value: `${annotations[fileName][lineNumber].length} annotation(s)` },
                                },
                            })
                        }
                    })
                }

                // Apply decorations
                editor.deltaDecorations(oldDecorations, newDecorations)

                // Update file list to show annotation indicators
                updateFileList()
            }

            // Button event listeners
            const newFileBtn = document.getElementById("newFile")
            if (newFileBtn) {
                newFileBtn.addEventListener("click", () => {
                    // Add folder selection in file modal
                    const folderSelect = document.getElementById("folderSelect") || document.createElement("select")
                    if (!document.getElementById("folderSelect")) {
                        folderSelect.id = "folderSelect"
                        const folderLabel = document.createElement("label")
                        folderLabel.htmlFor = "folderSelect"
                        folderLabel.textContent = "Folder:"

                        const folderGroup = document.createElement("div")
                        folderGroup.className = "form-group"
                        folderGroup.appendChild(folderLabel)
                        folderGroup.appendChild(folderSelect)

                        // Add before the submit button
                        const submitBtn = document.getElementById("submitFileDetails")
                        submitBtn.parentNode.insertBefore(folderGroup, submitBtn)
                    }

                    // Update folder options
                    folderSelect.innerHTML = '<option value="/">Root</option>'
                    Object.keys(folderStructure).forEach((path) => {
                        if (path !== "/") {
                            const option = document.createElement("option")
                            option.value = path
                            option.textContent = path
                            folderSelect.appendChild(option)
                        }
                    })

                    // Add share with all checkbox
                    const shareWithAllCheckbox = document.getElementById("shareWithAll") || document.createElement("input")
                    if (!document.getElementById("shareWithAll")) {
                        shareWithAllCheckbox.id = "shareWithAll"
                        shareWithAllCheckbox.type = "checkbox"
                        shareWithAllCheckbox.checked = true

                        const shareLabel = document.createElement("label")
                        shareLabel.htmlFor = "shareWithAll"
                        shareLabel.textContent = "Share with all users"

                        const shareGroup = document.createElement("div")
                        shareGroup.className = "form-group checkbox-group"
                        shareGroup.appendChild(shareWithAllCheckbox)
                        shareGroup.appendChild(shareLabel)

                        // Add before the submit button
                        const submitBtn = document.getElementById("submitFileDetails")
                        submitBtn.parentNode.insertBefore(shareGroup, submitBtn)
                    }

                    fileModal.style.display = "block"
                })
            }

            // Add folder button
            const addFolderBtn = document.getElementById("addFolder")
            if (addFolderBtn) {
                // Update the button text and icon to indicate it's for importing
                addFolderBtn.innerHTML = '<i class="fas fa-file-import"></i> Import Folder'
                addFolderBtn.title = "Import a folder from your device"

                // Create hidden file input for folder import
                const folderInput = document.getElementById("folderInput") || document.createElement("input")
                if (!document.getElementById("folderInput")) {
                    folderInput.id = "folderInput"
                    folderInput.type = "file"
                    folderInput.multiple = true
                    folderInput.webkitdirectory = true
                    folderInput.directory = true
                    folderInput.style.display = "none"
                    document.body.appendChild(folderInput)
                }

                // Handle folder import
                addFolderBtn.addEventListener("click", () => {
                    folderInput.click()
                })

                folderInput.addEventListener("change", async(e) => {
                    const files = e.target.files
                    if (!files || files.length === 0) return

                    const importedFiles = []

                    // Process each file
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i]
                        const relativePath = file.webkitRelativePath || file.relativePath || file.name

                        // Read file content
                        const content = await readFileContent(file)

                        importedFiles.push({
                            path: relativePath,
                            content: content,
                        })
                    }

                    // Send files to server
                    if (socket && socket.connected && importedFiles.length > 0) {
                        socket.emit("import-folder", {
                            roomId: currentRoomId,
                            files: importedFiles,
                            username: currentUsername,
                        })

                        showNotification(`Importing folder with ${importedFiles.length} files...`, "info")
                    }

                    // Reset input
                    folderInput.value = ""
                })
            }

            // Function to read file content
            function readFileContent(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = (e) => resolve(e.target.result)
                    reader.onerror = (e) => reject(e)
                    reader.readAsText(file)
                })
            }

            const submitFileDetailsBtn = document.getElementById("submitFileDetails")
            if (submitFileDetailsBtn) {
                submitFileDetailsBtn.addEventListener("click", () => {
                    const fileName = fileNameInput.value.trim()
                    const fileType = fileTypeInput.value
                    const folderPath = document.getElementById("folderSelect") ?
                        document.getElementById("folderSelect").value :
                        "/"
                    const shareWithAll = document.getElementById("shareWithAll") ?
                        document.getElementById("shareWithAll").checked :
                        false

                    if (!fileName || !fileType) {
                        errorMessage.textContent = "Please enter both file name and type."
                        errorMessage.style.display = "block"
                        return
                    }

                    const fullFileName = `${fileName}${fileType}`

                    if (openFiles[fullFileName]) {
                        errorMessage.textContent = `The file "${fullFileName}" already exists.`
                        errorMessage.style.display = "block"
                        return
                    }

                    openFiles[fullFileName] = { content: getDefaultContent(fileType), type: fileType }

                    // Set current user as the file owner
                    fileOwners[fullFileName] = {
                        socketId: currentSocketId,
                        username: currentUsername,
                    }

                    // Set edit permission for the creator
                    hasEditPermission[fullFileName] = true

                    // Update folder structure
                    if (!folderStructure[folderPath]) {
                        folderStructure[folderPath] = []
                    }
                    folderStructure[folderPath].push(fullFileName)

                    createEditor(fileName, fileType)
                    updateFileList()
                    fileModal.style.display = "none"
                    errorMessage.style.display = "none"

                    // Notify other users about the new file
                    if (socket && socket.connected) {
                        console.log(`Emitting file-created for ${fullFileName}`)
                        socket.emit("file-created", {
                            roomId: currentRoomId,
                            fileName: fullFileName,
                            content: openFiles[fullFileName].content,
                            shareWithAll: shareWithAll,
                            folderPath: folderPath,
                        })
                    }
                })
            }

            const closeModalBtn = document.getElementById("closeModal")
            if (closeModalBtn) {
                closeModalBtn.addEventListener("click", () => {
                    fileModal.style.display = "none"
                    errorMessage.style.display = "none"
                })
            }

            const saveFileBtn = document.getElementById("saveFile")
            if (saveFileBtn) {
                saveFileBtn.addEventListener("click", () => {
                    if (!currentFile) return
                    const content = editor.getValue()
                    const blob = new Blob([content], { type: "text/plain" })
                    const a = document.createElement("a")
                    a.href = URL.createObjectURL(blob)
                    a.download = currentFile
                    a.click()
                })
            }

            // Run code button event listener with improved async handling
            if (runCodeBtn) {
                runCodeBtn.addEventListener("click", async() => {
                    if (!currentFile) {
                        consoleOutput.textContent = "No file is open."
                        return
                    }

                    // Reset input state
                    isWaitingForInput = false
                    inputBuffer = ""
                    hideTerminalInput()

                    // Disable the button and show running state
                    runCodeBtn.disabled = true
                    runCodeBtn.textContent = "Running..."
                    consoleOutput.innerHTML = `<div class="running">Running code...</div>`

                    try {
                        const fileType = currentFile.substring(currentFile.lastIndexOf(".") + 1) // Extract file extension
                        const code = editor.getValue()

                        let result = ""
                        switch (fileType) {
                            case "c":
                                result = await runCodeWithJDoodle("c", code)
                                break
                            case "py":
                                result = await runCodeWithJDoodle("python3", code)
                                break
                            case "java":
                                result = await runCodeWithJDoodle("java", code)
                                break
                            case "js":
                                result = runJavaScript(code)
                                break
                            default:
                                result = await runCodeWithJDoodle(fileType, code)
                        }

                        consoleOutput.innerHTML = `<div class="${isWaitingForInput ? "" : "success"}">${formatOutput(result)}</div>`
                    } catch (error) {
                        console.error("Error executing code:", error)
                        consoleOutput.innerHTML = `<div class="error">Error: ${error.message}</div>`
                    } finally {
                        // Re-enable the button
                        runCodeBtn.disabled = false
                        runCodeBtn.textContent = "Run"
                    }
                })
            }

            // Add annotation button event listener
            if (addAnnotationBtn) {
                addAnnotationBtn.addEventListener("click", () => {
                    if (!editor || !currentFile) return

                    const position = editor.getPosition()
                    if (!position) return

                    const lineNumber = position.lineNumber

                    // Create annotation modal
                    const annotationModal = document.createElement("div")
                    annotationModal.className = "modal"
                    annotationModal.id = "annotationModal"

                    const modalContent = document.createElement("div")
                    modalContent.className = "modal-content"

                    modalContent.innerHTML = `
                          <h3>Add Annotation</h3>
                          <p>Adding annotation for ${currentFile} at line ${lineNumber}</p>
                          <textarea id="annotationText" placeholder="Enter your annotation here..." rows="4"></textarea>
                          <div class="modal-actions">
                              <button id="submitAnnotation" class="btn-primary">Add</button>
                              <button id="cancelAnnotation" class="btn-secondary">Cancel</button>
                          </div>
                      `

                    annotationModal.appendChild(modalContent)
                    document.body.appendChild(annotationModal)

                    // Show modal
                    annotationModal.style.display = "block"

                    // Focus textarea
                    document.getElementById("annotationText").focus()

                    // Add event listeners
                    document.getElementById("submitAnnotation").addEventListener("click", () => {
                        const text = document.getElementById("annotationText").value.trim()
                        if (text) {
                            addAnnotation(currentFile, lineNumber, text)
                            loadAnnotations(currentFile)
                        }
                        document.body.removeChild(annotationModal)
                    })

                    document.getElementById("cancelAnnotation").addEventListener("click", () => {
                        document.body.removeChild(annotationModal)
                    })
                })
            }

            // Toggle annotations panel
            if (toggleAnnotationsBtn && annotationsPanel) {
                toggleAnnotationsBtn.addEventListener("click", () => {
                    annotationsPanel.classList.toggle("open")
                    toggleAnnotationsBtn.classList.toggle("active")

                    if (annotationsPanel.classList.contains("open")) {
                        loadAnnotations(currentFile)
                    }
                })
            }

            // Toggle debug panel
            if (toggleDebugBtn && debugPanel) {
                toggleDebugBtn.addEventListener("click", () => {
                    debugPanel.classList.toggle("open")
                    toggleDebugBtn.classList.toggle("active")

                    if (debugPanel.classList.contains("open")) {
                        updateBreakpointsList()
                    }
                })
            }

            // Format output for display
            function formatOutput(output) {
                if (!output) return "No output"
                    // Replace HTML special characters but keep the actual newlines
                return output.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
            }

            if (changeThemeButton) {
                changeThemeButton.addEventListener("click", toggleTheme)
            }

            const shareLinkBtn = document.getElementById("shareLink")
            if (shareLinkBtn) {
                shareLinkBtn.addEventListener("click", () => {
                    // Get the appropriate server address
                    const baseUrl = window.location.origin
                    const shareLink = `${baseUrl}?room=${currentRoomId}`

                    // Create a temporary input element
                    const tempInput = document.createElement("input")
                    document.body.appendChild(tempInput)
                    tempInput.value = shareLink
                    tempInput.select()
                    document.execCommand("copy")
                    document.body.removeChild(tempInput)

                    // Show notification
                    showNotification(`Link copied to clipboard!<br><small>${shareLink}</small>`, "success", "📋")
                })
            }

            // Split.js configuration
            try {
                const Split = window.Split
                if (typeof Split === "function") {
                    const filePanelElement = document.querySelector(".file-panel")
                    const codeEditorElement = document.querySelector(".code-editor")

                    if (filePanelElement && codeEditorElement) {
                        Split([".file-panel", ".code-editor"], {
                            sizes: [20, 80],
                            minSize: [150, 300],
                            gutterSize: 1,
                        })
                    }

                    const topLayoutElement = document.querySelector(".top-layout")
                    const outputConsoleElement = document.querySelector(".output-console")

                    if (topLayoutElement && outputConsoleElement) {
                        Split([".top-layout", ".output-console"], {
                            sizes: [80, 20],
                            direction: "vertical",
                            gutterSize: 1,
                        })
                    }
                } else {
                    console.warn("Split.js not available, skipping split panel initialization")
                }
            } catch (error) {
                console.error("Error initializing Split.js:", error)
            }

            applyTheme()

            // Create a default file if none exists
            if (Object.keys(openFiles).length === 0) {
                const defaultFileName = "main.js"
                openFiles[defaultFileName] = {
                    content: "// Welcome to CodeCollab!\n// Start coding here...",
                    type: ".js",
                }
                createEditor("main", ".js")
                updateFileList()
            }

            // Make these functions globally accessible
            window.loadFile = loadFile
            window.updateFileList = updateFileList
            window.formatOutput = formatOutput
            window.updateFileOwnerIndicator = updateFileOwnerIndicator
            window.renderAnnotations = renderAnnotations
            window.loadAnnotations = loadAnnotations
            window.renderBreakpoints = renderBreakpoints
            window.updateBreakpointsList = updateBreakpointsList
        })
    }

    // Initialize voice chat
    function initializeVoiceChat() {
        if (!voiceChatPanel || !toggleVoiceChatBtn) return

        // Toggle voice chat panel
        toggleVoiceChatBtn.addEventListener("click", () => {
            voiceChatPanel.classList.toggle("open")
            toggleVoiceChatBtn.classList.toggle("active")

            if (voiceChatPanel.classList.contains("open")) {
                if (!isVoiceChatActive) {
                    startVoiceChat()
                }
            } else {
                if (isVoiceChatActive) {
                    stopVoiceChat()
                }
            }
        })
    }

    // Start voice chat
    async function startVoiceChat() {
        try {
            // Request user media
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            isVoiceChatActive = true

            // Update UI
            toggleVoiceChatBtn.classList.add("active")
            toggleVoiceChatBtn.innerHTML = '<i class="fas fa-microphone"></i>'

            // Add local user to voice chat users list
            addVoiceChatUser(currentUsername, true)

            // Notify server that we've joined voice chat  true)

            // Notify server that we've joined voice chat
            if (socket && socket.connected) {
                socket.emit("voice-chat-join", {
                    roomId: currentRoomId,
                    username: currentUsername,
                })
            }
        } catch (error) {
            console.error("Error starting voice chat:", error)
            showNotification("Could not access microphone. Please check permissions.", "error")
        }
    }

    // Stop voice chat
    function stopVoiceChat() {
        if (localStream) {
            // Stop all tracks
            localStream.getTracks().forEach((track) => track.stop())
            localStream = null
        }

        // Close all peer connections
        Object.values(peerConnections).forEach((pc) => pc.close())
        peerConnections = {}

        // Update UI
        isVoiceChatActive = false
        toggleVoiceChatBtn.classList.remove("active")
        toggleVoiceChatBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>'

        // Clear voice chat users list
        if (voiceChatUsers) {
            voiceChatUsers.innerHTML = ""
        }

        // Notify server that we've left voice chat
        if (socket && socket.connected) {
            socket.emit("voice-chat-leave", {
                roomId: currentRoomId,
                username: currentUsername,
            })
        }
    }

    // Add user to voice chat users list
    function addVoiceChatUser(username, isLocal = false) {
        if (!voiceChatUsers) return

        const userItem = document.createElement("div")
        userItem.className = "voice-chat-user"
        userItem.dataset.username = username

        // Get user color
        const userColor = userColors[username] || "#808080"

        userItem.innerHTML = `
              <div class="voice-chat-user-avatar" style="background-color: ${userColor}">
                  ${username.charAt(0).toUpperCase()}
              </div>
              <div class="voice-chat-user-name">${username}${isLocal ? " (You)" : ""}</div>
              <div class="voice-chat-user-status">
                  <i class="fas fa-microphone"></i>
              </div>
          `

        voiceChatUsers.appendChild(userItem)
    }

    // Remove user from voice chat users list
    function removeVoiceChatUser(username) {
        if (!voiceChatUsers) return

        const userItem = voiceChatUsers.querySelector(`.voice-chat-user[data-username="${username}"]`)
        if (userItem) {
            voiceChatUsers.removeChild(userItem)
        }
    }

    // Initialize WebRTC connection with a peer
    async function initializePeerConnection(peerSocketId, peerUsername, isInitiator) {
        // Create a new RTCPeerConnection
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
        })

        // Store the peer connection
        peerConnections[peerSocketId] = pc

        // Add local stream tracks to the peer connection
        if (localStream) {
            localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
        }

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate && socket && socket.connected) {
                socket.emit("voice-chat-ice-candidate", {
                    roomId: currentRoomId,
                    candidate: event.candidate,
                    targetSocketId: peerSocketId,
                })
            }
        }

        // Handle incoming tracks
        pc.ontrack = (event) => {
            // Create audio element for remote stream
            const audioElement = document.createElement("audio")
            audioElement.srcObject = event.streams[0]
            audioElement.autoplay = true
            audioElement.dataset.socketId = peerSocketId

            // Add to voice chat panel
            if (voiceChatPanel) {
                voiceChatPanel.appendChild(audioElement)
            }

            // Update UI to show user is connected
            const userItem = voiceChatUsers.querySelector(`.voice-chat-user[data-username="${peerUsername}"]`)
            if (userItem) {
                userItem.classList.add("connected")
            }
        }

        // If we're the initiator, create and send an offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)

                if (socket && socket.connected) {
                    socket.emit("voice-chat-offer", {
                        roomId: currentRoomId,
                        offer: pc.localDescription,
                        targetSocketId: peerSocketId,
                    })
                }
            } catch (error) {
                console.error("Error creating offer:", error)
            }
        }

        return pc
    }

    // Initialize terminals
    function initializeTerminals() {
        if (!terminalContainer || !addTerminalBtn || !terminalTabs) return

        // Add terminal button click handler
        addTerminalBtn.addEventListener("click", () => {
            addTerminal()
        })

        // Terminal theme select handler
        if (terminalThemeSelect) {
            terminalThemeSelect.addEventListener("change", () => {
                terminalTheme = terminalThemeSelect.value
                applyTerminalTheme(terminalTheme)
            })
        }

        // Shell select handler
        if (shellSelect) {
            shellSelect.addEventListener("change", () => {
                selectedShell = shellSelect.value

                // Notify server about shell change
                if (socket && socket.connected) {
                    socket.emit("terminal-shell-change", {
                        roomId: currentRoomId,
                        terminalId: terminals[activeTerminal].id,
                        shell: selectedShell,
                    })
                }
            })
        }

        // Create initial terminal
        addTerminal()
    }

    // Add a new terminal
    function addTerminal() {
        const terminalId = `terminal-${Date.now()}`

        // Create terminal tab
        const tab = document.createElement("div")
        tab.className = "terminal-tab"
        tab.dataset.terminalId = terminalId
        tab.innerHTML = `
              <span>Terminal ${terminals.length + 1}</span>
              <button class="close-terminal">×</button>
          `

        // Create terminal content
        const content = document.createElement("div")
        content.className = "terminal-content"
        content.id = terminalId

        // Add to DOM
        terminalTabs.appendChild(tab)
        terminalContainer.appendChild(content)

        // Create terminal object
        const terminal = {
            id: terminalId,
            history: [],
            shell: selectedShell,
        }

        // Add to terminals array
        terminals.push(terminal)

        // Initialize terminal history
        terminalHistory[terminalId] = []

        // Set as active terminal
        setActiveTerminal(terminals.length - 1)

        // Add event listeners
        tab.addEventListener("click", (e) => {
            if (e.target.classList.contains("close-terminal")) {
                closeTerminal(terminalId)
            } else {
                const index = terminals.findIndex((t) => t.id === terminalId)
                if (index !== -1) {
                    setActiveTerminal(index)
                }
            }
        })

        // Notify server about new terminal
        if (socket && socket.connected) {
            socket.emit("terminal-created", {
                roomId: currentRoomId,
                terminalId: terminalId,
                shell: selectedShell,
            })
        }

        return terminalId
    }

    // Set active terminal
    function setActiveTerminal(index) {
        if (index < 0 || index >= terminals.length) return

        // Update active terminal index
        activeTerminal = index

        // Update UI
        document.querySelectorAll(".terminal-tab").forEach((tab, i) => {
            tab.classList.toggle("active", i === index)
        })

        document.querySelectorAll(".terminal-content").forEach((content, i) => {
            content.style.display = i === index ? "block" : "none"
        })

        // Update shell select to match active terminal
        if (shellSelect && terminals[index]) {
            shellSelect.value = terminals[index].shell
        }
    }

    // Close terminal
    function closeTerminal(terminalId) {
        const index = terminals.findIndex((t) => t.id === terminalId)
        if (index === -1) return

        // Remove from DOM
        const tab = document.querySelector(`.terminal-tab[data-terminal-id="${terminalId}"]`)
        const content = document.getElementById(terminalId)

        if (tab) tab.remove()
        if (content) content.remove()

        // Remove from arrays
        terminals.splice(index, 1)
        delete terminalHistory[terminalId]

        // Update active terminal
        if (terminals.length === 0) {
            // No terminals left, add a new one
            addTerminal()
        } else if (activeTerminal >= terminals.length) {
            // Active terminal was removed, set to last terminal
            setActiveTerminal(terminals.length - 1)
        } else if (activeTerminal === index) {
            // Active terminal was removed, update UI
            setActiveTerminal(activeTerminal)
        }

        // Notify server about terminal closure
        if (socket && socket.connected) {
            socket.emit("terminal-closed", {
                roomId: currentRoomId,
                terminalId: terminalId,
            })
        }
    }

    // Apply terminal theme
    function applyTerminalTheme(theme) {
        document.querySelectorAll(".terminal-content").forEach((terminal) => {
            terminal.className = `terminal-content terminal-theme-${theme}`
        })
    }

    // Chat panel toggle
    if (chatToggle && chatPanel) {
        chatToggle.addEventListener("click", () => {
            chatPanel.classList.toggle("open")
            chatToggle.classList.toggle("active")
            const isOpen = chatPanel.classList.contains("open")
            chatToggle.setAttribute("aria-expanded", isOpen)
            chatToggle.setAttribute("aria-label", isOpen ? "Close chat" : "Open chat")
            chatPanel.style.transition = "right 0.3s ease-in-out"
            chatPanel.style.right = isOpen ? "0" : "-300px"
        })
    }

    // Add chat message function
    function addChatMessage(username, message) {
        if (!chatMessages) return

        const messageElement = document.createElement("div")
        messageElement.className = "chat-message"

        const now = new Date()
        const timeString = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`

        messageElement.innerHTML = `
              <div class="message-header">
                  <span class="message-username ${username === currentUsername ? "current-user" : ""}">${username}</span>
                  <span class="message-time">${timeString}</span>
              </div>
              <div class="message-content">${message}</div>
          `

        chatMessages.appendChild(messageElement)
        chatMessages.scrollTop = chatMessages.scrollHeight
    }

    // Send chat message
    if (sendChatButton && chatInput) {
        sendChatButton.addEventListener("click", () => {
            const message = chatInput.value.trim()
            if (message && socket && socket.connected) {
                socket.emit("send-message", {
                    roomId: currentRoomId,
                    username: currentUsername,
                    message: message,
                })

                // Add the message to the chat
                addChatMessage(currentUsername, message)

                // Clear the input
                chatInput.value = ""
            }
        })

        // Also send on Enter key
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                sendChatButton.click()
            }
        })
    }

    // Terminal input handling
    if (sendInputBtn && terminalInput) {
        sendInputBtn.addEventListener("click", sendTerminalInput)

        // Also send on Enter key
        terminalInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault()
                sendTerminalInput()
            }
        })
    }

    function initializeWebSocket(roomId, username, password, isAdmin) {
        currentUsername = username
        currentRoomId = roomId

        // Get the current host from the browser's location
        const socketUrl = window.location.origin

        console.log(`Connecting to socket at ${socketUrl}`)
        showNotification(`Connecting to server at ${socketUrl}...`, "info")

        // Connect to the server
        try {
            require(["socket.io"], (io) => {
                socket = io(socketUrl, {
                    transports: ["websocket", "polling"],
                    reconnectionAttempts: maxReconnectAttempts,
                    reconnectionDelay: 1000,
                    timeout: 20000,
                    forceNew: true,
                    autoConnect: true,
                })

                socket.on("connect", () => {
                    console.log("WebSocket connection established with ID:", socket.id)
                    connectionStatus = "connected"
                    reconnectAttempts = 0
                    showNotification("Connected to server", "success")

                    // Store current socket ID
                    currentSocketId = socket.id

                    if (isAdmin) {
                        socket.emit("create-room", { roomId, password, username })
                    } else {
                        socket.emit("join-room", { roomId, password, username })
                    }
                })

                socket.on("room-update", (users) => {
                    console.log("Room update received:", users)
                    if (userList) {
                        userList.innerHTML = ""
                        users.forEach((user) => addUser(user))
                    }
                })

                socket.on("user-joined", (username) => {
                    console.log("User joined:", username)
                    addUser(username)
                    showUserJoinedNotification(username)
                })

                socket.on("room-error", (error) => {
                    alert(error)
                        // Return to login screen on error
                    if (loginContainer) loginContainer.classList.remove("hidden")
                    if (editorContainer) editorContainer.classList.add("hidden")
                })

                socket.on("code-update", (data) => {
                    console.log("Code update received for file:", data.fileName)

                    if (data.fileName && data.code !== undefined) {
                        // Update the file content in our local storage
                        if (!openFiles[data.fileName]) {
                            const fileExt = data.fileName.substring(data.fileName.lastIndexOf("."))
                            openFiles[data.fileName] = {
                                content: data.code,
                                type: fileExt,
                            }
                            if (window.updateFileList) {
                                window.updateFileList()
                            }
                        } else {
                            openFiles[data.fileName].content = data.code
                        }

                        // Update the editor if we're currently viewing this file
                        if (editor && currentFile === data.fileName && isEditorReady) {
                            // Only update if the editor value is different to avoid cursor jumping
                            if (editor.getValue() !== data.code) {
                                isProcessingRemoteUpdate = true
                                const viewState = editor.saveViewState()
                                const selections = editor.getSelections()
                                editor.setValue(data.code)
                                editor.restoreViewState(viewState)
                                if (selections) {
                                    editor.setSelections(selections)
                                }
                                isProcessingRemoteUpdate = false

                                // Update the last sent code to avoid duplicate updates
                                lastSentCode[data.fileName] = data.code
                            }
                        } else {
                            // Store update for when the file is opened
                            pendingCodeUpdates[data.fileName] = data.code
                        }
                    }
                })

                // Handle cursor position updates
                socket.on("cursor-position-update", (data) => {
                    if (data.fileName && data.position && data.socketId && data.username) {
                        // Don't show our own cursor
                        if (data.socketId === currentSocketId) return

                        // Only show cursor if we're viewing the same file
                        if (currentFile === data.fileName && editor) {
                            // Store cursor position
                            if (!remoteCursors[data.socketId]) {
                                remoteCursors[data.socketId] = {
                                    username: data.username,
                                    position: data.position,
                                    color: userColors[data.username] || "#FF5733",
                                }
                            } else {
                                remoteCursors[data.socketId].position = data.position
                            }

                            // Update cursor display
                            updateRemoteCursors()
                        }
                    }
                })

                // Function to update remote cursors in the editor
                function updateRemoteCursors() {
                    if (!editor) return

                    // Remove existing cursor elements
                    document.querySelectorAll(".remote-cursor").forEach((el) => el.remove())

                    // Add cursor for each remote user
                    Object.keys(remoteCursors).forEach((socketId) => {
                        const cursor = remoteCursors[socketId]

                        // Convert position to pixel coordinates
                        const position = editor.getScrolledVisiblePosition(cursor.position)
                        if (!position) return

                        // Create cursor element
                        const cursorElement = document.createElement("div")
                        cursorElement.className = "remote-cursor"
                        cursorElement.style.backgroundColor = cursor.color
                        cursorElement.style.left = `${position.left}px`
                        cursorElement.style.top = `${position.top}px`

                        // Create label
                        const labelElement = document.createElement("div")
                        labelElement.className = "cursor-label"
                        labelElement.style.backgroundColor = cursor.color
                        labelElement.textContent = cursor.username

                        cursorElement.appendChild(labelElement)

                        // Add to editor container
                        editor.getDomNode().appendChild(cursorElement)
                    })
                }

                // Handle annotation updates
                socket.on("annotation-update", (data) => {
                    if (data.fileName && data.lineNumber && data.annotation) {
                        // Initialize annotations for this file if needed
                        if (!annotations[data.fileName]) {
                            annotations[data.fileName] = {}
                        }

                        // Initialize annotations for this line if needed
                        if (!annotations[data.fileName][data.lineNumber]) {
                            annotations[data.fileName][data.lineNumber] = []
                        }

                        // Add the annotation
                        annotations[data.fileName][data.lineNumber].push(data.annotation)

                        // Update UI if we're viewing this file
                        if (currentFile === data.fileName) {
                            if (window.renderAnnotations) {
                                window.renderAnnotations(data.fileName)
                            }

                            if (window.loadAnnotations) {
                                window.loadAnnotations(data.fileName)
                            }
                        }

                        // Show notification
                        showNotification(`New annotation added to ${data.fileName} at line ${data.lineNumber}`, "info")
                    }
                })

                // Handle annotation deletion
                socket.on("annotation-delete", (data) => {
                    if (data.fileName && data.lineNumber && data.annotation) {
                        if (annotations[data.fileName] && annotations[data.fileName][data.lineNumber]) {
                            // Find and remove the annotation
                            const index = annotations[data.fileName][data.lineNumber].findIndex(
                                (a) =>
                                a.text === data.annotation.text &&
                                a.author === data.annotation.author &&
                                a.timestamp === data.annotation.timestamp,
                            )

                            if (index !== -1) {
                                annotations[data.fileName][data.lineNumber].splice(index, 1)

                                // If no more annotations for this line, remove the line entry
                                if (annotations[data.fileName][data.lineNumber].length === 0) {
                                    delete annotations[data.fileName][data.lineNumber]
                                }

                                // If no more annotations for this file, remove the file entry
                                if (Object.keys(annotations[data.fileName]).length === 0) {
                                    delete annotations[data.fileName]
                                }

                                // Update UI if we're viewing this file
                                if (currentFile === data.fileName) {
                                    if (window.renderAnnotations) {
                                        window.renderAnnotations(data.fileName)
                                    }

                                    if (window.loadAnnotations) {
                                        window.loadAnnotations(data.fileName)
                                    }
                                }
                            }
                        }
                    }
                })

                // Handle breakpoint updates
                socket.on("breakpoint-update", (data) => {
                    if (data.fileName && data.breakpoints) {
                        // Update breakpoints for this file
                        breakpoints[data.fileName] = data.breakpoints

                        // Update UI if we're viewing this file
                        if (currentFile === data.fileName) {
                            if (window.renderBreakpoints) {
                                window.renderBreakpoints(data.fileName)
                            }
                        }

                        // Update breakpoints list in debug panel
                        if (window.updateBreakpointsList) {
                            window.updateBreakpointsList()
                        }
                    }
                })

                // Handle voice chat events
                socket.on("voice-chat-join", (data) => {
                    if (data.username && data.socketId) {
                        // Add user to voice chat users list
                        addVoiceChatUser(data.username)

                        // If we're in voice chat, initiate connection
                        if (isVoiceChatActive && data.socketId !== currentSocketId) {
                            initializePeerConnection(data.socketId, data.username, true)
                        }
                    }
                })

                socket.on("voice-chat-leave", (data) => {
                    if (data.username && data.socketId) {
                        // Remove user from voice chat users list
                        removeVoiceChatUser(data.username)

                        // Close peer connection if it exists
                        if (peerConnections[data.socketId]) {
                            peerConnections[data.socketId].close()
                            delete peerConnections[data.socketId]
                        }

                        // Remove audio element
                        const audioElement = document.querySelector(`audio[data-socket-id="${data.socketId}"]`)
                        if (audioElement) {
                            audioElement.remove()
                        }
                    }
                })

                socket.on("voice-chat-offer", async(data) => {
                    if (data.offer && data.socketId) {
                        try {
                            // Get username for this socket
                            const peerUsername = Object.entries(rooms[currentRoomId].users || {}).find(
                                ([id, name]) => id === data.socketId,
                            )

                            if (!peerUsername) return

                            // Create peer connection if it doesn't exist
                            let pc = peerConnections[data.socketId]
                            if (!pc) {
                                pc = await initializePeerConnection(data.socketId, peerUsername, false)
                            }

                            // Set remote description
                            await pc.setRemoteDescription(new RTCSessionDescription(data.offer))

                            // Create answer
                            const answer = await pc.createAnswer()
                            await pc.setLocalDescription(answer)

                            // Send answer
                            if (socket && socket.connected) {
                                socket.emit("voice-chat-answer", {
                                    roomId: currentRoomId,
                                    answer: pc.localDescription,
                                    targetSocketId: data.socketId,
                                })
                            }
                        } catch (error) {
                            console.error("Error handling offer:", error)
                        }
                    }
                })

                socket.on("voice-chat-answer", async(data) => {
                    if (data.answer && data.socketId && peerConnections[data.socketId]) {
                        try {
                            await peerConnections[data.socketId].setRemoteDescription(new RTCSessionDescription(data.answer))
                        } catch (error) {
                            console.error("Error handling answer:", error)
                        }
                    }
                })

                socket.on("voice-chat-ice-candidate", async(data) => {
                    if (data.candidate && data.socketId && peerConnections[data.socketId]) {
                        try {
                            await peerConnections[data.socketId].addIceCandidate(new RTCIceCandidate(data.candidate))
                        } catch (error) {
                            console.error("Error adding ICE candidate:", error)
                        }
                    }
                })

                // Handle terminal events
                socket.on("terminal-created", (data) => {
                    if (data.terminalId && data.socketId !== currentSocketId) {
                        // Add terminal if it doesn't exist
                        if (!terminals.find((t) => t.id === data.terminalId)) {
                            addTerminal()
                        }
                    }
                })

                socket.on("terminal-closed", (data) => {
                    if (data.terminalId) {
                        // Close terminal if it exists
                        closeTerminal(data.terminalId)
                    }
                })

                socket.on("terminal-output", (data) => {
                    if (data.terminalId && data.output) {
                        // Find terminal
                        const terminalContent = document.getElementById(data.terminalId)
                        if (terminalContent) {
                            // Append output
                            const outputElement = document.createElement("div")
                            outputElement.className = "terminal-output-line"
                            outputElement.textContent = data.output
                            terminalContent.appendChild(outputElement)

                            // Scroll to bottom
                            terminalContent.scrollTop = terminalContent.scrollHeight
                        }
                    }
                })

                socket.on("terminal-history-update", (data) => {
                    if (data.terminalId && data.history) {
                        // Update terminal history
                        terminalHistory[data.terminalId] = data.history
                    }
                })

                socket.on("terminal-shell-change", (data) => {
                    if (data.terminalId && data.shell) {
                        // Find terminal
                        const index = terminals.findIndex((t) => t.id === data.terminalId)
                        if (index !== -1) {
                            // Update shell
                            terminals[index].shell = data.shell

                            // Update UI if this is the active terminal
                            if (index === activeTerminal && shellSelect) {
                                shellSelect.value = data.shell
                            }
                        }
                    }
                })

                socket.on("receive-message", (data) => {
                    addChatMessage(data.username, data.message)
                })

                socket.on("file-created", (data) => {
                    console.log("File created event received:", data.fileName)
                    if (!openFiles[data.fileName]) {
                        const fileExt = data.fileName.substring(data.fileName.lastIndexOf("."))
                        openFiles[data.fileName] = {
                            content: data.content,
                            type: fileExt,
                        }

                        // Store the owner information
                        if (data.owner) {
                            fileOwners[data.fileName] = data.owner

                            // Set permission if file is shared with all
                            if (data.shareWithAll) {
                                hasEditPermission[data.fileName] = true
                            }
                        }

                        // Add file to folder structure
                        const folderPath = data.folderPath || "/"
                        if (!folderStructure[folderPath]) {
                            folderStructure[folderPath] = []
                        }
                        folderStructure[folderPath].push(data.fileName)

                        if (window.updateFileList) {
                            window.updateFileList()
                        }

                        // Show notification
                        showNotification(`New file created: <strong>${data.fileName}</strong>`, "info", "📄")
                    }
                })

                socket.on("sync-files", (files) => {
                    console.log("Syncing files from server:", files)
                        // Update our local files with the ones from the server
                    Object.keys(files).forEach((fileName) => {
                        openFiles[fileName] = {
                                content: files[fileName].content,
                                type: fileName.substring(fileName.lastIndexOf(".")),
                            }
                            // Also update the last sent code to avoid duplicate updates
                        lastSentCode[fileName] = files[fileName].content
                    })

                    if (window.updateFileList) {
                        window.updateFileList()
                    }

                    // If we have files but no current file selected, load the first one
                    if (Object.keys(openFiles).length > 0 && !currentFile && isEditorInitialized && window.loadFile) {
                        const firstFile = Object.keys(openFiles)[0]
                        const fileName = firstFile.substring(0, firstFile.lastIndexOf("."))
                        const fileExt = firstFile.substring(firstFile.lastIndexOf("."))
                        window.loadFile(fileName, fileExt)
                    }
                })

                // Handle file ownership sync
                socket.on("sync-file-owners", (ownersInfo) => {
                    console.log("Syncing file owners:", ownersInfo)
                    fileOwners = ownersInfo

                    // Initialize edit permissions based on ownership
                    Object.keys(ownersInfo).forEach((fileName) => {
                        const isOwner = ownersInfo[fileName].socketId === currentSocketId
                        const isAdmin = rooms[currentRoomId] && rooms[currentRoomId].adminSocketId === currentSocketId
                        hasEditPermission[fileName] = isOwner || isAdmin
                    })

                    // Update file list to show ownership
                    if (window.updateFileList) {
                        window.updateFileList()
                    }

                    // Update current file owner indicator if needed
                    if (currentFile && window.updateFileOwnerIndicator) {
                        window.updateFileOwnerIndicator(currentFile)
                    }
                })

                // Sync annotations
                socket.on("sync-annotations", (fileAnnotations) => {
                    console.log("Syncing annotations:", fileAnnotations)
                    annotations = fileAnnotations

                    // Update annotations in editor if needed
                    if (currentFile && annotations[currentFile]) {
                        if (window.renderAnnotations) {
                            window.renderAnnotations(currentFile)
                        }

                        if (window.loadAnnotations) {
                            window.loadAnnotations(currentFile)
                        }
                    }

                    // Update file list to show annotation indicators
                    if (window.updateFileList) {
                        window.updateFileList()
                    }
                })

                // Sync breakpoints
                socket.on("sync-breakpoints", (fileBreakpoints) => {
                    console.log("Syncing breakpoints:", fileBreakpoints)
                    breakpoints = fileBreakpoints

                    // Update breakpoints in editor if needed
                    if (currentFile && breakpoints[currentFile]) {
                        if (window.renderBreakpoints) {
                            window.renderBreakpoints(currentFile)
                        }
                    }

                    // Update breakpoints list in debug panel
                    if (window.updateBreakpointsList) {
                        window.updateBreakpointsList()
                    }
                })

                // Sync folder structure
                socket.on("sync-folder-structure", (structure) => {
                    console.log("Syncing folder structure:", structure)
                    folderStructure = structure

                    // Update file list to reflect folder structure
                    if (window.updateFileList) {
                        window.updateFileList()
                    }
                })

                // Sync file permissions
                socket.on("sync-file-permissions", (permissions) => {
                    console.log("Syncing file permissions:", permissions)
                    filePermissions = permissions

                    // Update permissions for current files
                    if (currentRoomId && permissions[currentRoomId]) {
                        Object.keys(permissions[currentRoomId]).forEach((fileName) => {
                            if (permissions[currentRoomId][fileName][currentSocketId] === "approved") {
                                hasEditPermission[fileName] = true

                                // Update editor if this is the current file
                                if (editor && currentFile === fileName) {
                                    console.log(`Updating editor permissions for ${fileName} to editable`)
                                    editor.updateOptions({ readOnly: false })
                                }
                            }
                        })
                    }

                    // Update file owner indicator if needed
                    if (currentFile && window.updateFileOwnerIndicator) {
                        window.updateFileOwnerIndicator(currentFile)
                    }
                })

                // Handle permission required notification
                socket.on("permission-required", (data) => {
                    showNotification(`You need permission to edit "${data.fileName}". Click to request permission.`, "warning")

                    // Update the file owner indicator
                    if (currentFile === data.fileName && window.updateFileOwnerIndicator) {
                        window.updateFileOwnerIndicator(currentFile)
                    }
                })

                // Handle permission request
                socket.on("permission-request", (data) => {
                    showPermissionRequestModal(data.fileName, data.requesterName, data.requesterSocketId)
                })

                // Handle permission request sent confirmation
                socket.on("permission-request-sent", (data) => {
                    showNotification(`Permission request sent to ${data.ownerName} for "${data.fileName}"`, "info")
                })

                // Handle permission request error
                socket.on("permission-request-error", (data) => {
                    showNotification(`Error requesting permission: ${data.message}`, "error")
                })

                // Handle permission response
                socket.on("permission-response", (data) => {
                    showNotification(data.message, data.approved ? "success" : "info")

                    // Update permission status
                    if (data.approved) {
                        hasEditPermission[data.fileName] = true

                        // Update editor read-only state if this is the current file
                        if (editor && currentFile === data.fileName) {
                            console.log(`Permission granted for ${data.fileName}, updating editor to editable`)
                            editor.updateOptions({ readOnly: false })
                        }
                    }

                    // Update UI if needed
                    if (currentFile === data.fileName && window.updateFileOwnerIndicator) {
                        window.updateFileOwnerIndicator(currentFile)
                    }
                })

                // Handle file deletion
                socket.on("file-deleted", (data) => {
                    if (openFiles[data.fileName]) {
                        // If the deleted file is currently open, close it
                        if (currentFile === data.fileName) {
                            // Switch to another file if available
                            const files = Object.keys(openFiles)
                            if (files.length > 1) {
                                const nextFile = files.find((f) => f !== data.fileName)
                                if (nextFile && window.loadFile) {
                                    const fileName = nextFile.substring(0, nextFile.lastIndexOf("."))
                                    const fileExt = nextFile.substring(nextFile.lastIndexOf("."))
                                    window.loadFile(fileName, fileExt)
                                }
                            } else {
                                // No other files, clear editor
                                if (editor) {
                                    editor.setValue("")
                                }
                                currentFile = null
                            }
                        }

                        // Remove the file from our local storage
                        delete openFiles[data.fileName]
                        delete fileOwners[data.fileName]
                        delete hasEditPermission[data.fileName]
                        delete annotations[data.fileName]
                        delete breakpoints[data.fileName]

                        // Remove from folder structure
                        for (const folderPath in folderStructure) {
                            const fileIndex = folderStructure[folderPath].indexOf(data.fileName)
                            if (fileIndex !== -1) {
                                folderStructure[folderPath].splice(fileIndex, 1)
                                break
                            }
                        }

                        // Update file list
                        if (window.updateFileList) {
                            window.updateFileList()
                        }

                        showNotification(`File "${data.fileName}" has been deleted`, "info")
                    }
                })

                // Handle file operation errors
                socket.on("file-operation-error", (data) => {
                    showNotification(`Error ${data.operation}ing file: ${data.message}`, "error")
                })

                // Request all files when joining a room
                socket.on("joined-room", () => {
                    socket.emit("request-files", { roomId: currentRoomId })
                })

                // Handle disconnection
                socket.on("disconnect", () => {
                    console.log("Disconnected from server")
                    connectionStatus = "disconnected"
                    showNotification("Disconnected from server. Attempting to reconnect...", "error")
                })

                // Handle reconnection
                socket.on("reconnect", (attemptNumber) => {
                    console.log(`Reconnected to server after ${attemptNumber} attempts`)
                    connectionStatus = "connected"
                    showNotification("Reconnected to server", "success")

                    // Re-join the room
                    if (currentRoomId && currentUsername) {
                        socket.emit("join-room", {
                            roomId: currentRoomId,
                            username: currentUsername,
                            password: password,
                        })
                    }
                })

                // Handle reconnection error
                socket.on("reconnect_error", (error) => {
                    console.error("Reconnection error:", error)
                    reconnectAttempts++
                    if (reconnectAttempts >= maxReconnectAttempts) {
                        showNotification("Failed to reconnect to server after multiple attempts", "error")
                    }
                })

                // Handle reconnection attempt
                socket.on("reconnect_attempt", (attemptNumber) => {
                    console.log(`Reconnection attempt ${attemptNumber}`)
                    connectionStatus = "connecting"
                    showNotification(`Attempting to reconnect (${attemptNumber}/${maxReconnectAttempts})...`, "warning")
                })

                // Handle error
                socket.on("error", (error) => {
                    console.error("Socket error:", error)
                    showNotification("Connection error", "error")
                })
            })
        } catch (error) {
            console.error("Error initializing WebSocket:", error)
            showNotification("Failed to connect to server", "error")
        }
    }

    // Handle window beforeunload event
    window.addEventListener("beforeunload", (e) => {
        if (socket && socket.connected) {
            socket.disconnect()
        }

        // Stop voice chat if active
        if (isVoiceChatActive) {
            stopVoiceChat()
        }
    })
})