// Lists the installed font families for Settings › Appearance › Fonts, with a fixed-pitch flag the web font APIs lack.
//   fonts → JSON [{ family, isMono }] on stdout, sorted by family; isMono when any face of the family is fixed-pitch
import AppKit

struct Listed: Encodable {
  let family: String
  let isMono: Bool
}

func isFixedPitch(_ family: String) -> Bool {
  (NSFontManager.shared.availableMembers(ofFontFamily: family) ?? []).contains { member in
    guard member.count > 3, let traits = member[3] as? NSNumber else { return false }
    return NSFontTraitMask(rawValue: traits.uintValue).contains(.fixedPitchFontMask)
  }
}

let listed = NSFontManager.shared.availableFontFamilies
  .filter { !$0.hasPrefix(".") }
  .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  .map { Listed(family: $0, isMono: isFixedPitch($0)) }
FileHandle.standardOutput.write(try JSONEncoder().encode(listed))
