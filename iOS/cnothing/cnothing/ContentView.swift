//
//  ContentView.swift
//  cnothing
//

import SwiftUI

struct ContentView: View {
    @ObservedObject private var api = APIClient.shared

    var body: some View {
        if api.isPaired {
            PendingRequestsView()
        } else {
            PairingView()
        }
    }
}

#Preview {
    ContentView()
}
