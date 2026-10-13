import { gradeAttempt } from "../../../../lib/ai/grade.mjs"

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const result = await gradeAttempt(body)
  return Response.json(result)
}
