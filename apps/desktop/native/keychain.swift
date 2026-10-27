import Foundation
import Security

// Fixed service namespace, bounded stdin and no credential-bearing argv or diagnostic output.
// New credential versions leave existing CLI items and earlier desktop versions untouched.
func fail(_ status: Int32 = 1) -> Never { exit(status) }
let args = CommandLine.arguments
if args.count != 3 || !["add", "read", "status", "delete"].contains(args[1]) { fail() }
let operation = args[1]
let identifier = args[2]
if UUID(uuidString: identifier) == nil || identifier != identifier.lowercased() { fail() }
let service = "moyyi.desktop.model.\(identifier)"
let login = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Keychains/login.keychain-db").path
var keychain: SecKeychain?
if SecKeychainOpen(login, &keychain) != errSecSuccess { fail() }
guard let keychain else { fail() }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
 kSecAttrService as String: service, kSecAttrAccount as String: "moyyi",
 kSecMatchSearchList as String: [keychain]]
if operation == "add" {
 var input = Data()
 do {
  while let chunk = try FileHandle.standardInput.read(upToCount: 1024), !chunk.isEmpty {
   input.append(chunk)
   if input.count > 4096 { fail() }
  }
 } catch { fail() }
 if input.isEmpty || !input.allSatisfy({ $0 >= 33 && $0 <= 126 }) { fail() }
 let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
   kSecAttrService as String: service, kSecAttrAccount as String: "moyyi",
   kSecAttrLabel as String: "moyyi desktop model connection", kSecUseKeychain as String: keychain,
   kSecValueData as String: input]
 let status = SecItemAdd(item as CFDictionary, nil)
 input.resetBytes(in: 0..<input.count)
 if status != errSecSuccess { fail() }
} else if operation == "delete" {
 let status = SecItemDelete(query as CFDictionary)
 if status != errSecSuccess && status != errSecItemNotFound { fail() }
} else {
 var request = query
 request[kSecMatchLimit as String] = kSecMatchLimitOne
 request[operation == "read" ? kSecReturnData as String : kSecReturnAttributes as String] = true
 var result: CFTypeRef?
 let status = SecItemCopyMatching(request as CFDictionary, &result)
 if status == errSecItemNotFound { fail(2) }
 if status != errSecSuccess { fail() }
 if operation == "read" {
  guard let data = result as? Data, !data.isEmpty, data.count <= 4096 else { fail() }
  FileHandle.standardOutput.write(data)
 }
}
