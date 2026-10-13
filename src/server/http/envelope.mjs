export function envelope(ok, code, data, error) {
  return {
    api_version: "job-control.v1",
    ok,
    code,
    command_id: null,
    replayed: false,
    data,
    error,
  }
}

export function validationError(message) {
  return envelope(false, "validation_error", {}, { message })
}
