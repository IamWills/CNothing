import SwiftUI
import Vision
import VisionKit

/// Camera QR scanner for pairing codes (payload: cnothing://pair?code=...&server=...).
struct QRScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    static var isSupported: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        if !uiViewController.isScanning {
            try? uiViewController.startScanning()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        private var didScan = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !didScan else { return }
            for item in addedItems {
                if case let .barcode(barcode) = item, let payload = barcode.payloadStringValue {
                    didScan = true
                    dataScanner.stopScanning()
                    onScan(payload)
                    return
                }
            }
        }
    }
}

/// Parses a scanned payload into pairing parameters.
enum PairingPayload {
    case pairing(code: String, server: URL?)
    case unrecognized

    static func parse(_ raw: String) -> PairingPayload {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        if let url = URL(string: trimmed),
           url.scheme == "cnothing",
           url.host == "pair",
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            let code = components.queryItems?.first(where: { $0.name == "code" })?.value ?? ""
            let serverRaw = components.queryItems?.first(where: { $0.name == "server" })?.value
            let server = serverRaw.flatMap(URL.init(string:))
            return code.isEmpty ? .unrecognized : .pairing(code: code, server: server)
        }

        // Bare manual code typed into a QR by hand (8 chars, unambiguous alphabet).
        let bare = trimmed.uppercased()
        if bare.count == 8, bare.allSatisfy({ $0.isLetter || $0.isNumber }) {
            return .pairing(code: bare, server: nil)
        }

        return .unrecognized
    }
}
