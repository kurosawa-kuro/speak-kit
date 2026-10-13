"use client"

import { Component } from "react"

export class AiBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <p>AI の表示で問題が起きました。練習はそのまま使えます。</p>
    }
    return this.props.children
  }
}
