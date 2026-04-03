import { createTriggersPlugin } from "../../../triggers/src/index"

export default createTriggersPlugin({
  directory: "/workspace",
  webhookHost: "0.0.0.0",
  webhookPort: 8099,
  publicBaseUrl: process.env.SANDBOX_PUBLIC_URL || "http://localhost:8000",
})
