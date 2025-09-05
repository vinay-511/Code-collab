const express = require("express")
const axios = require("axios")
const cors = require("cors")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(express.json())
app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Requested-With", "Authorization"],
    }),
)

// JDoodle API credentials
const JDOODLE_CLIENT_ID = process.env.JDOODLE_CLIENT_ID
const JDOODLE_CLIENT_SECRET = process.env.JDOODLE_CLIENT_SECRET

// Validate environment variables
if (!JDOODLE_CLIENT_ID || !JDOODLE_CLIENT_SECRET) {
    console.error("Error: JDoodle API credentials not found in environment variables.")
    console.error("Please set JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in .env file.")
    process.exit(1)
}

// JDoodle API endpoint
const JDOODLE_API_URL = "https://api.jdoodle.com/v1/execute"

// Route to execute code
app.post("/run", async(req, res) => {
    try {
        const { language, script, stdin = "" } = req.body

        if (!language || !script) {
            return res.status(400).json({
                success: false,
                output: "Language and code are required",
                error: true,
            })
        }

        console.log(`Executing ${language} code...`)

        // Prepare request to JDoodle API
        const jdoodleRequest = {
            clientId: JDOODLE_CLIENT_ID,
            clientSecret: JDOODLE_CLIENT_SECRET,
            script: script,
            language: language,
            versionIndex: "0",
            stdin: stdin,
        }

        // Send request to JDoodle API
        const response = await axios.post(JDOODLE_API_URL, jdoodleRequest, {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
        })

        // Process response
        const result = response.data

        // Return result
        return res.json({
            success: true,
            output: result.output,
            memory: result.memory,
            cpuTime: result.cpuTime,
            statusCode: result.statusCode,
        })
    } catch (error) {
        console.error("Error executing code:", error)

        // Handle API error
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                output: `API Error: ${error.response.data.error || error.message}`,
                error: true,
            })
        }

        // Handle network error
        return res.status(500).json({
            success: false,
            output: `Server error: ${error.message}`,
            error: true,
        })
    }
})

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        message: "JDoodle backend is running",
    })
})

// Start server
app.listen(PORT, () => {
    console.log(`JDoodle backend server running on port ${PORT}`)
    console.log(`API endpoint: http://localhost:${PORT}/run`)
})