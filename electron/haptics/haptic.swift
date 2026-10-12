// Plays the trackpad's alignment haptic once per line on stdin. macOS plays it only on a Force Touch trackpad with a finger on it.
import AppKit

while readLine() != nil {
  NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
}
