const { v4: uuidv4 } = require("uuid")

// Store rooms data
const rooms = {}
const roomFiles = {}
const fileOwners = {} // Track file owners by roomId -> fileName -> socketId
const pendingPermissions = {} // Track permission requests
const filePermissions = {} // Track file edit permissions
const folderStructure = {} // Track folder structure by roomId -> folderPath -> [files]
const annotations = {} // Track annotations by roomId -> fileName -> lineNumber -> [annotations]
const breakpoints = {} // Track breakpoints by roomId -> fileName -> [lineNumbers]
const terminals = {} // Track terminals by roomId -> terminalId -> {shell, history}

function createRoom(roomId, password, admin, adminSocketId) {
    rooms[roomId] = {
        password,
        admin,
        adminSocketId,
        users: {
            [adminSocketId]: admin,
        },
    }

    // Initialize files for this room
    roomFiles[roomId] = {}
    fileOwners[roomId] = {}
    pendingPermissions[roomId] = {}
    filePermissions[roomId] = {}
    folderStructure[roomId] = { "/": [] } // Root folder
    annotations[roomId] = {}
    breakpoints[roomId] = {}
    terminals[roomId] = {}

    // Add a default file
    const defaultFileName = "main.js"
    roomFiles[roomId][defaultFileName] = {
        content: "// Welcome to CodeCollab!\n// Start coding here...",
    }

    // Set the admin as the owner of the default file
    fileOwners[roomId][defaultFileName] = {
        socketId: adminSocketId,
        username: admin,
    }

    // Add default file to root folder
    folderStructure[roomId]["/"].push(defaultFileName)

    console.log(`Room created: ${roomId} by ${admin}`)
    console.log(`Active rooms: ${Object.keys(rooms).length}`)
}

function joinRoom(roomId, password, username, socketId) {
    if (rooms[roomId] && rooms[roomId].password === password) {
        rooms[roomId].users[socketId] = username
        console.log(`User ${username} joined room ${roomId}`)
        console.log(`Users in room ${roomId}: ${Object.values(rooms[roomId].users).join(", ")}`)
        return true
    }
    return false
}

function removeUser(socketId) {
    for (const roomId in rooms) {
        if (rooms[roomId].users[socketId]) {
            const username = rooms[roomId].users[socketId]
            delete rooms[roomId].users[socketId]

            console.log(`User ${username} left room ${roomId}`)
            console.log(`Remaining users in room ${roomId}: ${Object.values(rooms[roomId].users).join(", ")}`)

            // If room is empty, delete it
            if (Object.keys(rooms[roomId].users).length === 0) {
                delete rooms[roomId]
                delete roomFiles[roomId]
                delete fileOwners[roomId]
                delete pendingPermissions[roomId]
                delete filePermissions[roomId]
                delete folderStructure[roomId]
                delete annotations[roomId]
                delete breakpoints[roomId]
                delete terminals[roomId]
                console.log(`Room ${roomId} deleted (no users left)`)
            }

            return roomId
        }
    }
    return null
}

function getRoomUsers(roomId) {
    return rooms[roomId] ? Object.values(rooms[roomId].users) : []
}

function getRoomCode(roomId) {
    return roomFiles[roomId] && roomFiles[roomId]["main.js"] ? roomFiles[roomId]["main.js"].content : ""
}

function setRoomCode(roomId, code) {
    if (rooms[roomId]) {
        if (!roomFiles[roomId]) {
            roomFiles[roomId] = {}
        }
        if (!roomFiles[roomId]["main.js"]) {
            roomFiles[roomId]["main.js"] = { content: "" }
        }
        roomFiles[roomId]["main.js"].content = code
    }
}

function getRoomFiles(roomId) {
    return roomFiles[roomId] || {}
}

function addFileToRoom(roomId, fileName, content, creatorSocketId, folderPath = "/") {
    if (rooms[roomId]) {
        if (!roomFiles[roomId]) {
            roomFiles[roomId] = {}
        }
        if (!fileOwners[roomId]) {
            fileOwners[roomId] = {}
        }
        if (!folderStructure[roomId]) {
            folderStructure[roomId] = { "/": [] }
        }
        if (!folderStructure[roomId][folderPath]) {
            createFolderPath(roomId, folderPath)
        }

        roomFiles[roomId][fileName] = { content }

        // Store the owner with username
        fileOwners[roomId][fileName] = {
            socketId: creatorSocketId,
            username: rooms[roomId].users[creatorSocketId],
        }

        // Add file to folder structure
        folderStructure[roomId][folderPath].push(fileName)

        console.log(`File ${fileName} added to room ${roomId} by ${rooms[roomId].users[creatorSocketId]}`)
        return true
    }
    return false
}

function createFolderPath(roomId, folderPath) {
    if (!folderStructure[roomId]) {
        folderStructure[roomId] = { "/": [] }
    }

    // Create all parent folders if they don't exist
    const parts = folderPath.split("/").filter(Boolean)
    let currentPath = "/"

    folderStructure[roomId][currentPath] = folderStructure[roomId][currentPath] || []

    for (const part of parts) {
        const nextPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`
        folderStructure[roomId][nextPath] = folderStructure[roomId][nextPath] || []
        currentPath = nextPath
    }

    return folderStructure[roomId][folderPath]
}

function getFolderStructure(roomId) {
    return folderStructure[roomId] || { "/": [] }
}

function updateFileInRoom(roomId, fileName, content, socketId) {
    if (rooms[roomId]) {
        // Check if user has permission to edit this file
        if (hasFilePermission(roomId, fileName, socketId)) {
            if (!roomFiles[roomId]) {
                roomFiles[roomId] = {}
            }
            if (!roomFiles[roomId][fileName]) {
                roomFiles[roomId][fileName] = { content: "" }
            }
            roomFiles[roomId][fileName].content = content
            return true
        }
        return false
    }
    return false
}

// IMPROVED: Permission checking to enforce strict permissions
function hasFilePermission(roomId, fileName, socketId) {
    // If room doesn't exist, deny permission
    if (!rooms[roomId]) {
        return false
    }

    // If file doesn't exist yet, allow creation only
    if (!roomFiles[roomId] || !roomFiles[roomId][fileName]) {
        return true
    }

    // If user is the file owner, they have permission
    if (fileOwners[roomId] && fileOwners[roomId][fileName] && fileOwners[roomId][fileName].socketId === socketId) {
        return true
    }

    // If user is the room admin, they have permission
    if (rooms[roomId] && rooms[roomId].adminSocketId === socketId) {
        return true
    }

    // Check if user has been granted permission
    if (
        filePermissions[roomId] &&
        filePermissions[roomId][fileName] &&
        filePermissions[roomId][fileName][socketId] === "approved"
    ) {
        return true
    }

    // Otherwise, deny permission
    return false
}

// IMPROVED: Permission request handling
function requestFilePermission(roomId, fileName, requesterSocketId) {
    if (!rooms[roomId] || !fileOwners[roomId] || !fileOwners[roomId][fileName]) {
        return { success: false, message: "File or room not found" }
    }

    const ownerSocketId = fileOwners[roomId][fileName].socketId

    // Initialize permission structures if needed
    if (!pendingPermissions[roomId]) {
        pendingPermissions[roomId] = {}
    }
    if (!pendingPermissions[roomId][fileName]) {
        pendingPermissions[roomId][fileName] = {}
    }
    if (!filePermissions[roomId]) {
        filePermissions[roomId] = {}
    }
    if (!filePermissions[roomId][fileName]) {
        filePermissions[roomId][fileName] = {}
    }

    // Set permission as pending
    pendingPermissions[roomId][fileName][requesterSocketId] = "pending"

    console.log(
        `Permission request for ${fileName} in room ${roomId}: ${rooms[roomId].users[requesterSocketId]} -> ${rooms[roomId].users[ownerSocketId]}`,
    )

    return {
        success: true,
        ownerSocketId,
        requesterName: rooms[roomId].users[requesterSocketId],
        ownerName: rooms[roomId].users[ownerSocketId],
    }
}

// IMPROVED: Permission response handling
function respondToPermissionRequest(roomId, fileName, requesterSocketId, ownerSocketId, approved) {
    if (!pendingPermissions[roomId] ||
        !pendingPermissions[roomId][fileName] ||
        !pendingPermissions[roomId][fileName][requesterSocketId]
    ) {
        return { success: false, message: "No pending request found" }
    }

    // Check if responder is the file owner
    if (fileOwners[roomId][fileName].socketId !== ownerSocketId) {
        return { success: false, message: "Only the file owner can approve/deny requests" }
    }

    // Initialize file permissions if needed
    if (!filePermissions[roomId]) {
        filePermissions[roomId] = {}
    }
    if (!filePermissions[roomId][fileName]) {
        filePermissions[roomId][fileName] = {}
    }

    // Update permission status
    filePermissions[roomId][fileName][requesterSocketId] = approved ? "approved" : "denied"

    // Clear the pending request
    delete pendingPermissions[roomId][fileName][requesterSocketId]

    console.log(`Permission response for ${fileName} in room ${roomId}: ${approved ? "approved" : "denied"}`)

    return {
        success: true,
        status: approved ? "approved" : "denied",
        requesterName: rooms[roomId].users[requesterSocketId],
    }
}

// Grant permission to all users for a file
function grantPermissionToAll(roomId, fileName) {
    if (!rooms[roomId] || !roomFiles[roomId] || !roomFiles[roomId][fileName]) {
        return false
    }

    if (!filePermissions[roomId]) {
        filePermissions[roomId] = {}
    }

    if (!filePermissions[roomId][fileName]) {
        filePermissions[roomId][fileName] = {}
    }

    // Grant permission to all users in the room
    Object.keys(rooms[roomId].users).forEach((socketId) => {
        // Skip the file owner as they already have permission
        if (fileOwners[roomId][fileName].socketId !== socketId) {
            filePermissions[roomId][fileName][socketId] = "approved"
        }
    })

    console.log(`Permission granted to all users for ${fileName} in room ${roomId}`)
    return true
}

function getFileOwner(roomId, fileName) {
    if (!fileOwners[roomId] || !fileOwners[roomId][fileName]) {
        return null
    }

    return fileOwners[roomId][fileName]
}

// Get all file permissions for a room
function getRoomFilePermissions(roomId) {
    return filePermissions[roomId] || {}
}

// IMPROVED: File deletion with permission check
function deleteFile(roomId, fileName, socketId) {
    if (!rooms[roomId] || !roomFiles[roomId] || !roomFiles[roomId][fileName]) {
        return { success: false, message: "File or room not found" }
    }

    // Check if user has permission to delete
    if (!hasFilePermission(roomId, fileName, socketId)) {
        return { success: false, message: "You don't have permission to delete this file" }
    }

    // Don't allow deletion of the last file
    if (Object.keys(roomFiles[roomId]).length <= 1) {
        return { success: false, message: "Cannot delete the last file in the room" }
    }

    // Remove file from folder structure
    for (const folderPath in folderStructure[roomId]) {
        const fileIndex = folderStructure[roomId][folderPath].indexOf(fileName)
        if (fileIndex !== -1) {
            folderStructure[roomId][folderPath].splice(fileIndex, 1)
            break
        }
    }

    // Delete the file
    delete roomFiles[roomId][fileName]
    delete fileOwners[roomId][fileName]

    // Clean up permissions
    if (pendingPermissions[roomId] && pendingPermissions[roomId][fileName]) {
        delete pendingPermissions[roomId][fileName]
    }

    if (filePermissions[roomId] && filePermissions[roomId][fileName]) {
        delete filePermissions[roomId][fileName]
    }

    // Clean up annotations
    if (annotations[roomId] && annotations[roomId][fileName]) {
        delete annotations[roomId][fileName]
    }

    // Clean up breakpoints
    if (breakpoints[roomId] && breakpoints[roomId][fileName]) {
        delete breakpoints[roomId][fileName]
    }

    console.log(`File ${fileName} deleted from room ${roomId}`)
    return { success: true }
}

// Annotation functions
function addAnnotation(roomId, fileName, lineNumber, annotation) {
    if (!rooms[roomId] || !roomFiles[roomId] || !roomFiles[roomId][fileName]) {
        return false
    }

    if (!annotations[roomId]) {
        annotations[roomId] = {}
    }

    if (!annotations[roomId][fileName]) {
        annotations[roomId][fileName] = {}
    }

    if (!annotations[roomId][fileName][lineNumber]) {
        annotations[roomId][fileName][lineNumber] = []
    }

    annotations[roomId][fileName][lineNumber].push(annotation)
    console.log(`Annotation added to ${fileName}:${lineNumber} in room ${roomId}`)
    return true
}

function getAnnotations(roomId) {
    return annotations[roomId] || {}
}

function deleteAnnotation(roomId, fileName, lineNumber, annotation) {
    if (!annotations[roomId] || !annotations[roomId][fileName] || !annotations[roomId][fileName][lineNumber]) {
        return false
    }

    const index = annotations[roomId][fileName][lineNumber].findIndex(
        (a) => a.text === annotation.text && a.author === annotation.author && a.timestamp === annotation.timestamp,
    )

    if (index === -1) {
        return false
    }

    annotations[roomId][fileName][lineNumber].splice(index, 1)

    // Clean up empty arrays
    if (annotations[roomId][fileName][lineNumber].length === 0) {
        delete annotations[roomId][fileName][lineNumber]
    }

    if (Object.keys(annotations[roomId][fileName]).length === 0) {
        delete annotations[roomId][fileName]
    }

    console.log(`Annotation deleted from ${fileName}:${lineNumber} in room ${roomId}`)
    return true
}

// Breakpoint functions
function addBreakpoint(roomId, fileName, lineNumbers) {
    if (!rooms[roomId] || !roomFiles[roomId] || !roomFiles[roomId][fileName]) {
        return false
    }

    if (!breakpoints[roomId]) {
        breakpoints[roomId] = {}
    }

    breakpoints[roomId][fileName] = lineNumbers
    console.log(`Breakpoints updated for ${fileName} in room ${roomId}`)
    return true
}

function getBreakpoints(roomId) {
    return breakpoints[roomId] || {}
}

function removeBreakpoint(roomId, fileName) {
    if (!breakpoints[roomId] || !breakpoints[roomId][fileName]) {
        return false
    }

    delete breakpoints[roomId][fileName]
    console.log(`Breakpoints removed for ${fileName} in room ${roomId}`)
    return true
}

// Terminal functions
function addTerminal(roomId, terminalId, shell = "bash") {
    if (!rooms[roomId]) {
        return false
    }

    if (!terminals[roomId]) {
        terminals[roomId] = {}
    }

    terminals[roomId][terminalId] = {
        id: terminalId,
        shell: shell,
        history: [],
        createdAt: new Date().toISOString(),
    }

    console.log(`Terminal ${terminalId} added to room ${roomId}`)
    return true
}

function removeTerminal(roomId, terminalId) {
    if (!terminals[roomId] || !terminals[roomId][terminalId]) {
        return false
    }

    delete terminals[roomId][terminalId]
    console.log(`Terminal ${terminalId} removed from room ${roomId}`)
    return true
}

function getTerminals(roomId) {
    if (!terminals[roomId]) {
        return []
    }

    return Object.values(terminals[roomId])
}

function updateTerminalHistory(roomId, terminalId, history) {
    if (!terminals[roomId] || !terminals[roomId][terminalId]) {
        return false
    }

    terminals[roomId][terminalId].history = history
    return true
}

function getTerminalHistory(roomId, terminalId) {
    if (!terminals[roomId] || !terminals[roomId][terminalId]) {
        return []
    }

    return terminals[roomId][terminalId].history
}

function setTerminalShell(roomId, terminalId, shell) {
    if (!terminals[roomId] || !terminals[roomId][terminalId]) {
        return false
    }

    terminals[roomId][terminalId].shell = shell
    return true
}

function getTerminalShell(roomId, terminalId) {
    if (!terminals[roomId] || !terminals[roomId][terminalId]) {
        return "bash"
    }

    return terminals[roomId][terminalId].shell
}

module.exports = {
    createRoom,
    joinRoom,
    removeUser,
    getRoomUsers,
    getRoomCode,
    setRoomCode,
    getRoomFiles,
    addFileToRoom,
    updateFileInRoom,
    hasFilePermission,
    requestFilePermission,
    respondToPermissionRequest,
    getFileOwner,
    deleteFile,
    getRoomFilePermissions,
    grantPermissionToAll,
    createFolderPath,
    getFolderStructure,
    addAnnotation,
    getAnnotations,
    deleteAnnotation,
    addBreakpoint,
    getBreakpoints,
    removeBreakpoint,
    addTerminal,
    removeTerminal,
    getTerminals,
    updateTerminalHistory,
    getTerminalHistory,
    setTerminalShell,
    getTerminalShell,
}