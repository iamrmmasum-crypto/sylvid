package com.videocall

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.videocall.databinding.ItemPeerBinding

class PeerAdapter(
    private val peers: List<SignalingClient.Peer>,
    private val onCallClick: (SignalingClient.Peer) -> Unit
) : RecyclerView.Adapter<PeerAdapter.PeerViewHolder>() {

    inner class PeerViewHolder(val binding: ItemPeerBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PeerViewHolder {
        val binding = ItemPeerBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return PeerViewHolder(binding)
    }

    override fun onBindViewHolder(holder: PeerViewHolder, position: Int) {
        val peer = peers[position]
        holder.binding.peerName.text = peer.username
        holder.binding.peerId.text = peer.id.take(12) + "..."
        holder.binding.peerInitial.text = peer.username.firstOrNull()?.uppercase() ?: "?"
        holder.binding.btnCall.setOnClickListener { onCallClick(peer) }
    }

    override fun getItemCount(): Int = peers.size
}
