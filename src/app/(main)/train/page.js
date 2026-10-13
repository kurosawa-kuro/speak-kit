"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Train } from "./train"

function TrainRoute() {
  const searchParams = useSearchParams()
  return (
    <Train
      key={searchParams.toString()}
      planMode={searchParams.get("plan") === "today"}
      openPractice={searchParams.get("tab") === "practice"}
      skillKey={searchParams.get("skill")}
    />
  )
}

export default function TrainPage() {
  return (
    <Suspense>
      <TrainRoute />
    </Suspense>
  )
}
