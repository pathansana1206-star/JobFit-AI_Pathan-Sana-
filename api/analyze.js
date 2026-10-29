export default async function handler(req, res) {
    // 1. Allow only POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // 2. Read the API key from Vercel environment variables
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'Server API key is not configured.'
            });
        }

        // 3. Read the user's resume and job description
        const { resume, jobDesc } = req.body || {};

        if (
            typeof resume !== 'string' ||
            typeof jobDesc !== 'string' ||
            resume.trim().length < 50 ||
            jobDesc.trim().length < 50 ||
            resume.length > 30000 ||
            jobDesc.length > 30000
        ) {
            return res.status(400).json({
                error: 'Please provide a valid resume and job description.'
            });
        }

        // 4. Give Gemini instructions for analyzing the resume
        const systemPrompt = `
You are an expert career coach and ATS specialist.

Analyze the resume against the job description.

Return ONLY a valid JSON object with these exact fields:
{
  "ats_score": 0,
  "summary": "Overall assessment",
  "strengths": ["Strength 1", "Strength 2"],
  "missing_keywords": ["Keyword 1", "Keyword 2"],
  "improvements": ["Improvement 1", "Improvement 2"]
}

Rules:
- ats_score must be a number from 0 to 100.
- Identify actual missing keywords from the job description.
- Give specific, actionable suggestions.
- Do not invent experience or qualifications.
- Return no markdown or text outside the JSON object.
`;

        const userPrompt = `
Resume:
${resume}

Job Description:
${jobDesc}
`;

        // 5. Send the request to Gemini from the backend
        const geminiResponse = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: userPrompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 2048,
                        responseMimeType: 'application/json'
                    }
                })
            }
        );

        const data = await geminiResponse.json();

        if (!geminiResponse.ok) {
            console.error('Gemini request failed:', geminiResponse.status);

            return res.status(502).json({
                error: 'The AI service could not complete your request. Please try again.'
            });
        }

        // 6. Extract the AI-generated response
        const aiText = data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('');

        if (!aiText) {
            return res.status(502).json({
                error: 'The AI service returned an empty response.'
            });
        }

        // 7. Convert the response into JSON
        let analysis;

        try {
            analysis = JSON.parse(aiText);
        } catch (error) {
            console.error('Gemini returned invalid JSON.');

            return res.status(502).json({
                error: 'The AI returned an invalid response. Please try again.'
            });
        }

        // 8. Check the response fields
        if (
            typeof analysis.ats_score !== 'number' ||
            analysis.ats_score < 0 ||
            analysis.ats_score > 100 ||
            typeof analysis.summary !== 'string' ||
            !Array.isArray(analysis.strengths) ||
            !Array.isArray(analysis.missing_keywords) ||
            !Array.isArray(analysis.improvements)
        ) {
            return res.status(502).json({
                error: 'The AI returned an invalid analysis. Please try again.'
            });
        }

        // 9. Return the analysis to your website
        return res.status(200).json(analysis);

    } catch (error) {
        console.error('Resume analysis error:', error.message);

        return res.status(500).json({
            error: 'An unexpected error occurred. Please try again.'
        });
    }
}