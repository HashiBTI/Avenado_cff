/**
 * server.js
 * CFF Backend
 *
 * Features:
 * - Serves CFF frontend
 * - Gemini AI integration
 * - Anthropic AI integration
 * - Values Assessment
 * - Ask CFF Chat
 * - Supabase Lead Submission
 * - Rate Limiting
 * - Validation
 * - Security headers
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.set("trust proxy", 1);

/* ================================================================== */
/* CONFIGURATION                                                      */
/* ================================================================== */

const PORT =
    Number(process.env.PORT) ||
    3000;

const AI_PROVIDER =
    (
        process.env.AI_PROVIDER ||
        "gemini"
    ).toLowerCase();

const AI_MODEL =
    process.env.AI_MODEL ||
    (
        AI_PROVIDER === "gemini"
            ? "gemini-2.5-flash"
            : "claude-sonnet-5"
    );

const GEMINI_API_KEY =
    process.env.GEMINI_API_KEY ||
    "AQ.Ab8RN6LTKg1fZYlg5mwGV_zSJTKXVNMw3T5ctJz2ZvSaGEDBEA";

const ANTHROPIC_API_KEY =
    process.env.ANTHROPIC_API_KEY ||
    "AQ.Ab8RN6LTKg1fZYlg5mwGV_zSJTKXVNMw3T5ctJz2ZvSaGEDBEA";

const CORS_ORIGIN =
    process.env.CORS_ORIGIN ||
    true;

const RATE_LIMIT_MAX =
    Number(
        process.env.RATE_LIMIT_MAX
    ) || 20;

const RATE_LIMIT_WINDOW_MS =
    15 * 60 * 1000;


/* ================================================================== */
/* SUPABASE CONFIGURATION                                             */
/* ================================================================== */

const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    "";

/*
 * Server-side key. Prefer the SECRET (service-role) key here — it never
 * leaves the backend. Falls back to the publishable/anon key so existing
 * deployments keep working.
 *
 * NOTE: the previous fallback here was the Supabase *URL*, which is not a
 * key at all. That made createClient() silently build a client that could
 * never authenticate. Fixed to an empty string so the "not configured"
 * warning below actually fires.
 */
const SUPABASE_KEY =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

/*
 * Browser-side key. This one is DESIGNED to be public — it is protected by
 * Row Level Security, not by secrecy. It is handed to the frontend by the
 * generated /js/config.js route below.
 *
 * Never put SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY here.
 */
const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";


/* ================================================================== */
/* URL VALIDATION                                                     */
/* ================================================================== */

function isValidHttpUrl(value) {

    try {

        const parsed =
            new URL(value);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );

    } catch {

        return false;

    }

}


/* ================================================================== */
/* SUPABASE ORIGINS FOR CSP                                           */
/* ================================================================== */

/*
 * Returns the exact origins the browser needs to reach for Supabase Auth,
 * derived from SUPABASE_URL so nothing is hard-coded. Includes the wss://
 * variant because supabase-js opens a realtime socket on some flows.
 */
function supabaseConnectSources(rawUrl) {

    if (
        !rawUrl ||
        !isValidHttpUrl(rawUrl)
    ) {

        return [];

    }

    const origin =
        new URL(rawUrl).origin;

    return [
        origin,
        origin.replace(
            /^https:/,
            "wss:"
        )
    ];

}


const SUPABASE_CONNECT_SRC =
    supabaseConnectSources(
        SUPABASE_URL
    );


/* ================================================================== */
/* INITIALISE SUPABASE                                                */
/* ================================================================== */

let supabase = null;

if (
    SUPABASE_URL &&
    SUPABASE_KEY
) {

    if (
        isValidHttpUrl(
            SUPABASE_URL
        )
    ) {

        try {

            supabase =
                createClient(
                    SUPABASE_URL,
                    SUPABASE_KEY,
                    {
                        auth: {

                            persistSession:
                                false,

                            autoRefreshToken:
                                false

                        }
                    }
                );

        } catch (error) {

            console.warn(
                `⚠️ Could not initialise Supabase client (${error.message}).`
            );

        }

    } else {

        console.warn(
            `⚠️ Invalid SUPABASE_URL: ${SUPABASE_URL}`
        );

    }

}


/* ================================================================== */
/* STARTUP CONFIGURATION WARNINGS                                     */
/* ================================================================== */

if (
    AI_PROVIDER === "gemini" &&
    !GEMINI_API_KEY
) {

    console.warn(
        "⚠️ GEMINI_API_KEY is not configured."
    );

}

if (
    AI_PROVIDER === "anthropic" &&
    !ANTHROPIC_API_KEY
) {

    console.warn(
        "⚠️ ANTHROPIC_API_KEY is not configured."
    );

}

if (!supabase) {

    console.warn(
        "⚠️ Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY."
    );

}

if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY
) {

    console.warn(
        "⚠️ Browser auth is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env — without them, sign up / login will not work."
    );

}


/* ================================================================== */
/* VALUES ASSESSMENT QUESTIONS                                       */
/* ================================================================== */

const QUESTIONS = [

    {
        n: 1,
        q: "How do you fill your space?"
    },

    {
        n: 2,
        q: "How do you spend your time?"
    },

    {
        n: 3,
        q: "How do you spend your energy?"
    },

    {
        n: 4,
        q: "How do you spend your money?"
    },

    {
        n: 5,
        q: "In which areas are you most organised?"
    },

    {
        n: 6,
        q: "Where are you most reliable?"
    },

    {
        n: 7,
        q: "What dominates your thoughts?"
    },

    {
        n: 8,
        q: "What do you visualise most?"
    },

    {
        n: 9,
        q: "What do you most often talk to yourself about?"
    },

    {
        n: 10,
        q: "What do you most often talk to others about?"
    },

    {
        n: 11,
        q: "What inspires you?"
    },

    {
        n: 12,
        q: "Which goals stand out in your life and have stood the test of time?"
    },

    {
        n: 13,
        q: "What topics do you regularly study, read about, or research?"
    }

];


/* ================================================================== */
/* VALIDATION SCHEMAS                                                 */
/* ================================================================== */

const AnswerSchema =
    z.object({

        n:
            z.number()
                .int()
                .min(1)
                .max(13),

        q:
            z.string()
                .min(1)
                .max(300),

        values:
            z.array(
                z.string()
                    .trim()
                    .min(1)
            )
                .length(3)

    });


const RequestSchema =
    z.object({

        role:
            z.string()
                .trim()
                .min(1)
                .max(80),

        answers:
            z.array(
                AnswerSchema
            )
                .length(13)

    });


const ChatHistoryItemSchema =
    z.object({

        role:
            z.enum([
                "user",
                "assistant"
            ]),

        content:
            z.string()
                .trim()
                .min(1)
                .max(2000)

    });


const ChatRequestSchema =
    z.object({

        message:
            z.string()
                .trim()
                .min(1)
                .max(1000),

        history:
            z.array(
                ChatHistoryItemSchema
            )
                .optional()
                .default([])

    });


const LeadRequestSchema =
    z.object({

        name:
            z.string()
                .trim()
                .min(2)
                .max(100),

        phone:
            z.string()
                .trim()
                .min(7)
                .max(20)
                .regex(
                    /^[0-9+()\-\s]+$/
                ),

        email:
            z.union([

                z.string()
                    .email()
                    .max(150),

                z.literal(""),

                z.null()

            ])
                .optional()
                .transform(
                    value =>
                        value || null
                )

    });


const ConfidenceEnum =
    z.enum([
        "strong",
        "moderate",
        "emerging"
    ]);


const TopValueSchema =
    z.object({

        name:
            z.string(),

        confidenceLevel:
            ConfidenceEnum,

        evidence:
            z.string(),

        explanation:
            z.string()
                .optional()
                .default("")

    });


const SupportingValueSchema =
    z.object({

        name:
            z.string(),

        confidenceLevel:
            ConfidenceEnum,

        evidence:
            z.string()

    });


const AnalysisSchema =
    z.object({

        topValues:
            z.array(
                TopValueSchema
            )
                .length(3),

        supportingValues:
            z.array(
                SupportingValueSchema
            )
                .length(5),

        repeatedThemes:
            z.array(
                z.string()
            )
                .default([]),

        behaviouralPatterns:
            z.array(
                z.string()
            )
                .default([]),

        timeAreas:
            z.array(
                z.string()
            )
                .default([]),

        energyAreas:
            z.array(
                z.string()
            )
                .default([]),

        moneyAreas:
            z.array(
                z.string()
            )
                .default([]),

        inspirationSources:
            z.array(
                z.string()
            )
                .default([]),

        longTermGoals:
            z.array(
                z.string()
            )
                .default([]),

        learningInterests:
            z.array(
                z.string()
            )
                .default([]),

        possibleConflicts:
            z.array(
                z.string()
            )
                .default([]),

        personalStrengths:
            z.array(
                z.string()
            )
                .default([]),

        developmentAreas:
            z.array(
                z.string()
            )
                .default([]),

        valuesStatement:
            z.string(),

        recommendedNextSteps:
            z.array(
                z.string()
            )
                .default([])

    });


/* ================================================================== */
/* AI SYSTEM PROMPT                                                   */
/* ================================================================== */

const SYSTEM_PROMPT = `
You are the AI Advisor for the Company Formation Framework application.

Your responsibility is to analyse the user's complete set of 13 answers
accurately, respectfully, and systematically.

Always analyse ALL 13 answers before drawing conclusions.

Analyse patterns across:
- Time
- Energy
- Money
- Thoughts
- Communication
- Organisation
- Reliability
- Inspiration
- Goals
- Learning
- Behaviour

Use evidence directly from the user's responses.

Do not invent information.

You MUST return ONLY valid JSON.

Do NOT return markdown.

Do NOT use code fences.

Do NOT place any explanation before the JSON.

Do NOT place any explanation after the JSON.

Return EXACTLY the following JSON structure:

{
  "topValues": [
    {
      "name": "Value name",
      "confidenceLevel": "strong",
      "evidence": "Evidence from the user's answers",
      "explanation": "Explanation of why this is a major value"
    },
    {
      "name": "Value name",
      "confidenceLevel": "moderate",
      "evidence": "Evidence from the user's answers",
      "explanation": "Explanation of why this is a major value"
    },
    {
      "name": "Value name",
      "confidenceLevel": "emerging",
      "evidence": "Evidence from the user's answers",
      "explanation": "Explanation of why this is a major value"
    }
  ],

  "supportingValues": [
    {
      "name": "Supporting value",
      "confidenceLevel": "strong",
      "evidence": "Evidence from the user's answers"
    },
    {
      "name": "Supporting value",
      "confidenceLevel": "moderate",
      "evidence": "Evidence from the user's answers"
    },
    {
      "name": "Supporting value",
      "confidenceLevel": "moderate",
      "evidence": "Evidence from the user's answers"
    },
    {
      "name": "Supporting value",
      "confidenceLevel": "emerging",
      "evidence": "Evidence from the user's answers"
    },
    {
      "name": "Supporting value",
      "confidenceLevel": "emerging",
      "evidence": "Evidence from the user's answers"
    }
  ],

  "repeatedThemes": [
    "Theme"
  ],

  "behaviouralPatterns": [
    "Pattern"
  ],

  "timeAreas": [
    "Area"
  ],

  "energyAreas": [
    "Area"
  ],

  "moneyAreas": [
    "Area"
  ],

  "inspirationSources": [
    "Source"
  ],

  "longTermGoals": [
    "Goal"
  ],

  "learningInterests": [
    "Interest"
  ],

  "possibleConflicts": [
    "Conflict"
  ],

  "personalStrengths": [
    "Strength"
  ],

  "developmentAreas": [
    "Development area"
  ],

  "valuesStatement":
    "A concise personalised statement describing the user's major values.",

  "recommendedNextSteps": [
    "Recommended next step"
  ]
}

STRICT JSON RULES:

1. topValues MUST contain exactly 3 objects.

2. supportingValues MUST contain exactly 5 objects.

3. confidenceLevel MUST contain only:
   "strong"
   "moderate"
   "emerging"

4. Every topValues object MUST contain:
   name
   confidenceLevel
   evidence
   explanation

5. Every supportingValues object MUST contain:
   name
   confidenceLevel
   evidence

6. repeatedThemes MUST be an array of strings.

7. behaviouralPatterns MUST be an array of strings.

8. timeAreas MUST be an array of strings.

9. energyAreas MUST be an array of strings.

10. moneyAreas MUST be an array of strings.

11. inspirationSources MUST be an array of strings.

12. longTermGoals MUST be an array of strings.

13. learningInterests MUST be an array of strings.

14. possibleConflicts MUST be an array of strings.

15. personalStrengths MUST be an array of strings.

16. developmentAreas MUST be an array of strings.

17. recommendedNextSteps MUST be an array of strings.

18. valuesStatement MUST be a string.

19. Never omit any required field.

20. Never return null.

21. Never use undefined.

22. Never include comments inside the JSON.

23. Never include markdown.

24. Never include text outside the JSON object.

25. Ensure the final response is valid JSON that JSON.parse() can parse.
`;


/* ================================================================== */
/* CHAT SYSTEM PROMPT                                                 */
/* ================================================================== */

const CHAT_SYSTEM_PROMPT = `
You are the Ask CFF AI assistant.

You are part of the Company Formation Framework application.

Help users understand:

- Company Formation Framework
- Business Formation
- Values Assessment
- Business Owner
- Employee
- Visitor
- Business values
- Personal values
- Organisational clarity
- Company formation concepts

Keep answers clear, useful, professional and friendly.

Do not invent information.

Keep normal chat answers concise unless the user asks for more detail.
`;


/* ================================================================== */
/* BUILD VALUES USER MESSAGE                                         */
/* ================================================================== */

function buildUserMessage(
    role,
    answers
) {

    const lines =
        answers
            .map(
                answer =>

`Q${answer.n}. ${answer.q}

Answer 1: ${answer.values[0]}
Answer 2: ${answer.values[1]}
Answer 3: ${answer.values[2]}`

            )
            .join(
                "\n\n"
            );

    return `User Role: ${role}

The user completed all 13 Values Assessment questions.

Analyse ALL answers together.

${lines}`;

}


/* ================================================================== */
/* ANTHROPIC API                                                      */
/* ================================================================== */

async function callAnthropic({
    systemPrompt,
    userMessage,
    messages,
    maxTokens
}) {

    if (
        !ANTHROPIC_API_KEY
    ) {

        const error =
            new Error(
                "Anthropic API key missing"
            );

        error.code =
            "MISSING_API_KEY";

        throw error;

    }


    const response =
        await fetch(
            "https://api.anthropic.com/v1/messages",
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    "x-api-key":
                        ANTHROPIC_API_KEY,

                    "anthropic-version":
                        "2023-06-01"

                },

                body:
                    JSON.stringify({

                        model:
                            AI_MODEL,

                        max_tokens:
                            maxTokens ||
                            4000,

                        system:
                            systemPrompt,

                        messages:
                            messages ||
                            [
                                {

                                    role:
                                        "user",

                                    content:
                                        userMessage

                                }
                            ]

                    })

            }
        );


    if (
        !response.ok
    ) {

        const errorBody =
            await response
                .text()
                .catch(
                    () => ""
                );

        console.error(
            `CFF: Anthropic API returned ${response.status} for model "${AI_MODEL}":`,
            errorBody
        );

        throw new Error(
            `Anthropic returned ${response.status}`
        );

    }


    const data =
        await response.json();


    const textBlock =
        data.content &&
        data.content.find(
            item =>
                item.type === "text"
        );


    if (
        !textBlock ||
        !textBlock.text
    ) {

        console.error(
            "Anthropic full response:",
            JSON.stringify(
                data,
                null,
                2
            )
        );

        throw new Error(
            "Anthropic returned an empty response"
        );

    }


    return (
        textBlock.text
    );

}


/* ================================================================== */
/* GEMINI API                                                         */
/* ================================================================== */

async function callGemini({
    systemPrompt,
    userMessage,
    messages,
    maxTokens,
    jsonMode = false
}) {

    if (
        !GEMINI_API_KEY
    ) {

        const error =
            new Error(
                "Gemini API key missing"
            );

        error.code =
            "MISSING_API_KEY";

        throw error;

    }


    const chatMessages =
        messages ||
        [
            {

                role:
                    "user",

                content:
                    userMessage

            }
        ];


    const contents =
        chatMessages.map(
            message => ({

                role:
                    message.role === "assistant"
                        ? "model"
                        : "user",

                parts: [
                    {
                        text:
                            message.content
                    }
                ]

            })
        );


    const generationConfig = {

        maxOutputTokens:
            maxTokens ||
            4000,

        temperature:
            jsonMode
                ? 0.2
                : 0.7

    };


    if (
        jsonMode
    ) {

        generationConfig.responseMimeType =
            "application/json";

    }


    const response =
        await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    "x-goog-api-key":
                        GEMINI_API_KEY

                },

                body:
                    JSON.stringify({

                        system_instruction: {

                            parts: [
                                {
                                    text:
                                        systemPrompt
                                }
                            ]

                        },

                        contents,

                        generationConfig

                    })

            }
        );


    if (
        !response.ok
    ) {

        const errorBody =
            await response
                .text()
                .catch(
                    () => ""
                );


        console.error(
            `CFF: Gemini API returned ${response.status} for model "${AI_MODEL}":`,
            errorBody
        );


        throw new Error(
            `Gemini returned ${response.status}`
        );

    }


    const data =
        await response.json();


    const candidate =
        data &&
        data.candidates &&
        data.candidates[0];


    const text =
        candidate &&
        candidate.content &&
        candidate.content.parts &&
        candidate.content.parts
            .map(
                part =>
                    part.text || ""
            )
            .join("")
            .trim();


    if (
        !text
    ) {

        console.error(
            "========== GEMINI EMPTY RESPONSE =========="
        );

        console.error(
            JSON.stringify(
                data,
                null,
                2
            )
        );

        console.error(
            "==========================================="
        );


        throw new Error(
            "Gemini returned an empty response"
        );

    }


    return text;

}


/* ================================================================== */
/* AI PROVIDER ROUTER                                                 */
/* ================================================================== */

const PROVIDERS = {

    anthropic:
        callAnthropic,

    gemini:
        callGemini

};


async function callAiProvider(
    args
) {

    const providerFunction =
        PROVIDERS[
            AI_PROVIDER
        ];


    if (
        !providerFunction
    ) {

        throw new Error(
            `Unsupported AI provider: ${AI_PROVIDER}`
        );

    }


    return (
        providerFunction(
            args
        )
    );

}


/* ================================================================== */
/* JSON EXTRACTION                                                    */
/* ================================================================== */

function extractJson(raw) {

    if (
        typeof raw !== "string"
    ) {

        throw new Error(
            "AI response is not a string"
        );

    }


    let cleaned =
        raw
            .replace(
                /```json/gi,
                ""
            )
            .replace(
                /```/g,
                ""
            )
            .trim();


    try {

        return (
            JSON.parse(
                cleaned
            )
        );

    } catch (
        firstError
    ) {

        const firstBrace =
            cleaned.indexOf(
                "{"
            );

        const lastBrace =
            cleaned.lastIndexOf(
                "}"
            );


        if (
            firstBrace !== -1 &&
            lastBrace !== -1 &&
            lastBrace >
                firstBrace
        ) {

            const possibleJson =
                cleaned.substring(
                    firstBrace,
                    lastBrace + 1
                );


            return (
                JSON.parse(
                    possibleJson
                )
            );

        }


        throw firstError;

    }

}


/* ================================================================== */
/* EXPRESS SECURITY                                                   */
/* ================================================================== */

app.disable(
    "x-powered-by"
);


app.use(
    helmet({

        contentSecurityPolicy: {

            directives: {

                defaultSrc: [
                    "'self'"
                ],

                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://fonts.googleapis.com"
                ],

                fontSrc: [
                    "'self'",
                    "https://fonts.gstatic.com"
                ],

                scriptSrc: [
                    "'self'"
                ],

                /*
                 * Supabase Auth runs in the browser and talks directly to
                 * the project's REST + auth endpoints, so those origins
                 * must be allow-listed here or every login is blocked by
                 * CSP before it leaves the page.
                 *
                 * scriptSrc deliberately stays at 'self': the Supabase JS
                 * bundle is served from this server (see /vendor/supabase.js
                 * below) rather than from a third-party CDN.
                 */
                connectSrc: [
                    "'self'",
                    ...SUPABASE_CONNECT_SRC
                ],

                imgSrc: [
                    "'self'",
                    "data:"
                ],

                objectSrc: [
                    "'none'"
                ]

            }

        }

    })
);


app.use(
    cors({
        origin:
            CORS_ORIGIN
    })
);


app.use(
    express.json({
        limit:
            "100kb"
    })
);


/* ================================================================== */
/* RATE LIMITERS                                                      */
/* ================================================================== */

const analyseLimiter =
    rateLimit({

        windowMs:
            RATE_LIMIT_WINDOW_MS,

        max:
            RATE_LIMIT_MAX,

        standardHeaders:
            true,

        legacyHeaders:
            false

    });


const chatLimiter =
    rateLimit({

        windowMs:
            RATE_LIMIT_WINDOW_MS,

        max:
            30,

        standardHeaders:
            true,

        legacyHeaders:
            false

    });


const leadLimiter =
    rateLimit({

        windowMs:
            RATE_LIMIT_WINDOW_MS,

        max:
            10,

        standardHeaders:
            true,

        legacyHeaders:
            false

    });


/* ================================================================== */
/* STATIC FILE ROUTES                                                 */
/* ================================================================== */

app.get(
    "/manifest.json",
    (
        req,
        res,
        next
    ) => {

        res.type(
            "application/manifest+json"
        );

        next();

    }
);


app.get(
    "/sw.js",
    (
        req,
        res,
        next
    ) => {

        res.set(
            "Service-Worker-Allowed",
            "/"
        );

        next();

    }
);


/*
 * /js/config.js is GENERATED here rather than served from disk, so the
 * Supabase project URL and publishable (anon) key live in .env only and
 * never get committed to the repo.
 *
 * The anon key is public by design — it is what every Supabase browser
 * app ships. Access is controlled by Row Level Security policies in the
 * database, not by hiding this value. The SECRET/service-role key is
 * never sent here.
 *
 * Must be registered BEFORE express.static, otherwise the on-disk
 * js/config.js placeholder wins.
 */
app.get(
    "/js/config.js",
    (
        req,
        res
    ) => {

        const payload = {

            API_BASE_URL:
                "",

            SUPABASE_URL:
                SUPABASE_URL,

            SUPABASE_ANON_KEY:
                SUPABASE_ANON_KEY

        };


        res.type(
            "application/javascript"
        );

        // No caching: a stale config would break login after a key rotation.
        res.set(
            "Cache-Control",
            "no-store"
        );


        return (
            res.send(
                `/* Generated at runtime by server/server.js — do not edit. */\n` +
                `window.CFF_CONFIG = ${JSON.stringify(payload, null, 2)};\n`
            )
        );

    }
);


/*
 * Serve the Supabase browser SDK from our own origin instead of a CDN.
 * Keeps the CSP scriptSrc at 'self' and means no third-party script is
 * needed for login to work.
 */
app.get(
    "/vendor/supabase.js",
    (
        req,
        res,
        next
    ) => {

        try {

            const bundlePath =
                require.resolve(
                    "@supabase/supabase-js/dist/umd/supabase.js"
                );

            res.type(
                "application/javascript"
            );

            return (
                res.sendFile(
                    bundlePath
                )
            );

        } catch (error) {

            console.error(
                "CFF: could not locate the Supabase UMD bundle. Run `npm install`.",
                error.message
            );

            return next();

        }

    }
);


app.use(
    express.static(
        path.join(
            __dirname,
            ".."
        ),
        {

            dotfiles:
                "ignore",

            index:
                "index.html"

        }
    )
);


/* ================================================================== */
/* HEALTH CHECK                                                       */
/* ================================================================== */

app.get(
    "/api/health",
    (
        req,
        res
    ) => {

        return (
            res.status(
                200
            )
                .json({

                    success:
                        true,

                    server:
                        "CFF",

                    aiProvider:
                        AI_PROVIDER,

                    aiModel:
                        AI_MODEL,

                    aiConfigured:
                        AI_PROVIDER === "gemini"
                            ? Boolean(
                                GEMINI_API_KEY
                            )
                            : Boolean(
                                ANTHROPIC_API_KEY
                            ),

                    supabaseConfigured:
                        Boolean(
                            supabase
                        )

                })
        );

    }
);


/* ================================================================== */
/* LEAD SUBMISSION                                                    */
/* ================================================================== */

app.post(
    "/api/leads",
    leadLimiter,
    async (
        req,
        res
    ) => {

        if (
            !supabase
        ) {

            return (
                res.status(
                    500
                )
                    .json({

                        error:
                            "The lead database is not configured on this server.",

                        code:
                            "SUPABASE_NOT_CONFIGURED"

                    })
            );

        }


        const parsed =
            LeadRequestSchema
                .safeParse(
                    req.body
                );


        if (
            !parsed.success
        ) {

            return (
                res.status(
                    400
                )
                    .json({

                        error:
                            "Please enter a valid name, phone number, and email address.",

                        code:
                            "VALIDATION_ERROR",

                        details:
                            parsed.error.issues.map(
                                issue => ({

                                    path:
                                        issue.path,

                                    message:
                                        issue.message

                                })
                            )

                    })
            );

        }


        const {
            name,
            phone,
            email
        } =
            parsed.data;


        try {

            /*
             * IMPORTANT:
             *
             * We do NOT use:
             *
             * .insert(...).select()
             *
             * because .select() requires SELECT permission
             * when Row Level Security is enabled.
             *
             * We only need INSERT for this lead form.
             */

            const {
                error
            } =
                await supabase
                    .from(
                        "leads"
                    )
                    .insert([
                        {

                            name,

                            phone,

                            email

                        }
                    ]);


            if (
                error
            ) {

                console.log(
                    "========== SUPABASE ERROR =========="
                );

                console.log(
                    "Message:",
                    error.message
                );

                console.log(
                    "Code:",
                    error.code
                );

                console.log(
                    "Details:",
                    error.details
                );

                console.log(
                    "Hint:",
                    error.hint
                );

                console.log(
                    "Full error:",
                    error
                );

                console.log(
                    "===================================="
                );


                return (
                    res.status(
                        500
                    )
                        .json({

                            error:
                                error.message ||
                                "Supabase could not save the lead.",

                            code:
                                error.code ||
                                "LEAD_INSERT_FAILED",

                            details:
                                error.details ||
                                null,

                            hint:
                                error.hint ||
                                null

                        })
                );

            }


            console.log(
                "✅ Lead saved successfully."
            );


            return (
                res.status(
                    201
                )
                    .json({

                        success:
                            true,

                        message:
                            "Your enquiry has been submitted successfully."

                    })
            );

        } catch (
            error
        ) {

            console.log(
                "========== NODE ERROR =========="
            );

            console.log(
                error
            );

            console.log(
                "================================"
            );


            return (
                res.status(
                    500
                )
                    .json({

                        error:
                            error.message ||
                            "Unexpected server error.",

                        code:
                            "LEAD_INSERT_FAILED"

                    })
            );

        }

    }
);


/* ================================================================== */
/* VALUES ASSESSMENT API                                              */
/* ================================================================== */

app.post(
    "/api/analyse-values",
    analyseLimiter,
    async (
        req,
        res
    ) => {

        const parsed =
            RequestSchema
                .safeParse(
                    req.body
                );


        if (
            !parsed.success
        ) {

            return (
                res.status(
                    400
                )
                    .json({

                        error:
                            "Your submission is incomplete or invalid. Please make sure all 13 questions have three answers each.",

                        code:
                            "VALIDATION_ERROR",

                        details:
                            parsed.error.issues.map(
                                issue => ({

                                    path:
                                        issue.path,

                                    message:
                                        issue.message

                                })
                            )

                    })
            );

        }


        const {
            role,
            answers
        } =
            parsed.data;


        const answersByNumber =
            new Map(
                answers.map(
                    answer => [

                        answer.n,

                        answer

                    ]
                )
            );


        for (
            const question
            of QUESTIONS
        ) {

            const submittedQuestion =
                answersByNumber.get(
                    question.n
                );


            if (
                !submittedQuestion ||
                submittedQuestion.q.trim() !==
                    question.q
            ) {

                return (
                    res.status(
                        400
                    )
                        .json({

                            error:
                                "The submitted questions do not match the Values Assessment. Please reload and try again.",

                            code:
                                "QUESTION_MISMATCH"

                        })
                );

            }

        }


        try {

            const userMessage =
                buildUserMessage(
                    role,
                    answers
                );


            console.log(
                "CFF: Starting AI values analysis..."
            );


            const rawResponse =
                await callAiProvider({

                    systemPrompt:
                        SYSTEM_PROMPT,

                    userMessage,

                    maxTokens:
                        6000,

                    jsonMode:
                        AI_PROVIDER ===
                        "gemini"

                });


            let result;


            try {

                result =
                    extractJson(
                        rawResponse
                    );

            } catch (
                error
            ) {

                console.error(
                    "========== AI INVALID JSON =========="
                );

                console.error(
                    "JSON parsing error:",
                    error.message
                );

                console.error(
                    "Raw AI response:"
                );

                console.error(
                    rawResponse
                );

                console.error(
                    "====================================="
                );


                return (
                    res.status(
                        502
                    )
                        .json({

                            error:
                                "The AI returned a response we could not read. Please try again.",

                            code:
                                "AI_INVALID_JSON"

                        })
                );

            }


            const validated =
                AnalysisSchema
                    .safeParse(
                        result
                    );


            if (
                !validated.success
            ) {

                console.error(
                    "========== AI SCHEMA ERROR =========="
                );

                console.error(
                    JSON.stringify(
                        validated.error.issues,
                        null,
                        2
                    )
                );

                console.error(
                    "AI RESULT:"
                );

                console.error(
                    JSON.stringify(
                        result,
                        null,
                        2
                    )
                );

                console.error(
                    "====================================="
                );


                return (
                    res.status(
                        502
                    )
                        .json({

                            error:
                                "The AI response was in an unexpected format. Please try again.",

                            code:
                                "AI_SCHEMA_INVALID",

                            details:
                                validated.error.issues.map(
                                    issue => ({

                                        path:
                                            issue.path,

                                        message:
                                            issue.message

                                    })
                                )

                        })
                );

            }


            console.log(
                "✅ CFF values analysis completed successfully."
            );


            return (
                res.status(
                    200
                )
                    .json({

                        result:
                            validated.data

                    })
            );

        } catch (
            error
        ) {

            console.error(
                "CFF: AI provider call failed:",
                error
            );


            if (
                error.code ===
                "MISSING_API_KEY"
            ) {

                return (
                    res.status(
                        500
                    )
                        .json({

                            error:
                                AI_PROVIDER === "gemini"

                                    ? "The server is not configured with a Gemini API key. Add GEMINI_API_KEY to your .env file."

                                    : "The server is not configured with an Anthropic API key. Add ANTHROPIC_API_KEY to your .env file.",

                            code:
                                "MISSING_API_KEY"

                        })
                );

            }


            return (
                res.status(
                    502
                )
                    .json({

                        error:
                            "The AI provider could not complete the request. Please try again in a moment.",

                        code:
                            "AI_PROVIDER_ERROR"

                    })
            );

        }

    }
);


/* ================================================================== */
/* ASK CFF AI CHAT                                                    */
/* ================================================================== */

app.post(
    "/api/chat",
    chatLimiter,
    async (
        req,
        res
    ) => {

        const parsed =
            ChatRequestSchema
                .safeParse(
                    req.body
                );


        if (
            !parsed.success
        ) {

            return (
                res.status(
                    400
                )
                    .json({

                        error:
                            "Your message could not be read. Please try again.",

                        code:
                            "VALIDATION_ERROR",

                        details:
                            parsed.error.issues.map(
                                issue => ({

                                    path:
                                        issue.path,

                                    message:
                                        issue.message

                                })
                            )

                    })
            );

        }


        const {
            message,
            history
        } =
            parsed.data;


        const trimmedHistory =
            history.slice(
                -10
            );


        const messages = [

            ...trimmedHistory.map(
                item => ({

                    role:
                        item.role,

                    content:
                        item.content

                })
            ),

            {

                role:
                    "user",

                content:
                    message

            }

        ];


        try {

            const reply =
                await callAiProvider({

                    systemPrompt:
                        CHAT_SYSTEM_PROMPT,

                    messages,

                    maxTokens:
                        1000,

                    jsonMode:
                        false

                });


            return (
                res.status(
                    200
                )
                    .json({

                        reply:
                            reply.trim()

                    })
            );

        } catch (
            error
        ) {

            console.error(
                "CFF: Chat AI provider failed:",
                error
            );


            if (
                error.code ===
                "MISSING_API_KEY"
            ) {

                return (
                    res.status(
                        500
                    )
                        .json({

                            error:
                                AI_PROVIDER === "gemini"

                                    ? "The server is not configured with a Gemini API key. Add GEMINI_API_KEY to your .env file."

                                    : "The server is not configured with an Anthropic API key. Add ANTHROPIC_API_KEY to your .env file.",

                            code:
                                "MISSING_API_KEY"

                        })
                );

            }


            return (
                res.status(
                    502
                )
                    .json({

                        error:
                            "The AI provider could not complete the request. Please try again in a moment.",

                        code:
                            "AI_PROVIDER_ERROR"

                    })
            );

        }

    }
);


/* ================================================================== */
/* UNKNOWN API ROUTE                                                  */
/* ================================================================== */

app.use(
    "/api",
    (
        req,
        res
    ) => {

        return (
            res.status(
                404
            )
                .json({

                    error:
                        "API route not found.",

                    code:
                        "NOT_FOUND"

                })
        );

    }
);


/* ================================================================== */
/* GLOBAL ERROR HANDLER                                               */
/* ================================================================== */

// eslint-disable-next-line no-unused-vars
app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "CFF: Unhandled server error:",
            error
        );


        return (
            res.status(
                500
            )
                .json({

                    error:
                        "Something went wrong on the server.",

                    code:
                        "INTERNAL_ERROR"

                })
        );

    }
);


/* ================================================================== */
/* START SERVER                                                       */
/* ================================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            `CFF server running at http://localhost:${PORT}`
        );

        console.log(
            `AI provider: ${AI_PROVIDER} (${AI_MODEL})`
        );

        console.log(
            `Gemini API: ${
                GEMINI_API_KEY
                    ? "CONFIGURED"
                    : "NOT CONFIGURED"
            }`
        );

        console.log(
            `Supabase leads: ${
                supabase
                    ? "CONFIGURED"
                    : "NOT CONFIGURED"
            }`
        );

        console.log(
            "========================================"
        );

    }
);