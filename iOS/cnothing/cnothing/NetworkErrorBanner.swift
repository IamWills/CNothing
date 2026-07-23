import SwiftUI

/// Shown when a network / TLS request fails, with an explicit Refresh action so
/// the user does not have to force-quit the app.
struct NetworkErrorBanner: View {
    let message: String
    let isWorking: Bool
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }

            Button {
                onRefresh()
            } label: {
                if isWorking {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
        }
        .padding(.vertical, 4)
    }
}
