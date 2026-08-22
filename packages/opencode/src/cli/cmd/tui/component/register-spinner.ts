import { getComponentCatalogue, extend } from "@opentui/solid/components"
import { SpinnerRenderable } from "opentui-spinner"
import "opentui-spinner/solid"

export function registerOpencodeSpinner() {
  if (!("spinner" in getComponentCatalogue())) extend({ spinner: SpinnerRenderable })
}
