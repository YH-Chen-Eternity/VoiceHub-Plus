<template>
  <div class="community-shell custom-scrollbar">
    <div class="community-head">
      <div class="community-head-main">
        <h2 class="community-title">{{ t.title }}</h2>
        <p class="community-subtitle">{{ t.subtitle }}</p>
      </div>
      <div class="community-head-actions">
        <NotificationCenter />
        <button v-if="canReview" class="ghost-button" type="button" @click="goReview">
          <ShieldCheck :size="16" />
          <span>{{ t.goReview }}</span>
        </button>
        <button
          v-if="!isGuest"
          class="primary-button"
          :disabled="!settings.enabled || ban.muted"
          type="button"
          @click="openPublish"
        >
          <Plus :size="16" />
          <span>{{ t.publish }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-card">
      <Loader2 class="animate-spin" :size="26" />
      <p>{{ t.loading || '正在加载…' }}</p>
    </div>

    <div v-else-if="fatalError" class="state-card">
      <AlertTriangle :size="26" />
      <p>{{ fatalError }}</p>
      <button class="ghost-button" type="button" @click="init">{{ t.retry || '重试' }}</button>
    </div>

    <div v-else-if="!isOpen" class="state-card">
      <Lock :size="26" />
      <h3>{{ t.disabledTitle }}</h3>
      <p>{{ t.disabledDesc }}</p>
      <button v-if="canReview" class="ghost-button" type="button" @click="goReview">
        <ShieldCheck :size="16" />
        <span>{{ t.goReview }}</span>
      </button>
    </div>

    <template v-else>
      <div v-if="ban.muted" class="mute-banner">
        <Lock :size="16" />
        <div>
          <span>{{ t.muted }}</span>
          <span v-if="ban.permanent" class="mute-extra">· {{ t.permanent }}</span>
          <span v-else-if="ban.until" class="mute-extra">· {{ t.muteUntil }} {{ formatDateOnly(ban.until) }}</span>
          <span v-if="ban.reason" class="mute-extra">· {{ ban.reason }}</span>
        </div>
      </div>

      <div v-if="!settings.enabled" class="closed-banner">
        <Info :size="16" />
        <span>{{ t.closedForUsers }}</span>
      </div>

      <div class="board-rail" role="tablist">
        <button
          :class="{ active: activeBoardId === 0 }"
          class="board-chip"
          type="button"
          @click="selectBoard(0)"
        >
          {{ t.boardAll }}
        </button>
        <button
          v-for="board in boards"
          :key="board.id"
          :class="{ active: activeBoardId === board.id, dimmed: !board.isActive }"
          class="board-chip"
          type="button"
          @click="selectBoard(board.id)"
        >
          <span>{{ board.name }}</span>
          <span class="board-count">{{ board.postCount }}</span>
        </button>
      </div>

      <div class="community-grid">
        <main class="community-main">
          <div class="feed-controls">
            <label class="feed-search">
              <Search :size="14" />
              <input
                v-model="searchQuery"
                :placeholder="t.searchPlaceholder"
                type="search"
                @input="onSearchInput"
              >
            </label>
            <div class="feed-sort">
              <button
                :class="{ active: sortMode === 'latest' }"
                type="button"
                @click="setSort('latest')"
              >
                {{ t.sortLatest }}
              </button>
              <button
                :class="{ active: sortMode === 'hot' }"
                type="button"
                @click="setSort('hot')"
              >
                {{ t.sortHot }}
              </button>
            </div>
          </div>

          <div class="feed-toolbar">
            <span v-if="filterMine" class="feed-hint">{{ t.myPosts }}</span>
            <span v-else-if="activeBoardId" class="feed-hint">
              {{ boards.find((item) => item.id === activeBoardId)?.name }}
            </span>
            <button
              :class="{ active: filterMine }"
              class="mine-toggle"
              type="button"
              @click="toggleMine"
            >
              <UserRound :size="14" />
              <span>{{ t.filterMine }}</span>
            </button>
          </div>

          <div v-if="feedLoading && !posts.length" class="feed-state">
            <Loader2 class="animate-spin" :size="22" />
          </div>

          <div v-else-if="!posts.length" class="feed-state">
            <MessageCircle :size="26" />
            <p>{{ t.empty }}</p>
          </div>

          <div v-else ref="feedListRef" class="feed-list">
            <article
              v-for="post in posts"
              :key="post.id"
              :data-post-id="post.id"
              class="post-card"
            >
              <header class="post-head">
                <button class="identity" type="button" @click="openProfile(post.author.id)">
                  <span class="identity-name">{{ post.author.displayName }}</span>
                  <span class="identity-meta">
                    <span v-if="post.author.title" class="identity-title">{{ post.author.title }}</span>
                    <span class="identity-board">{{ post.board.name }}</span>
                  </span>
                </button>
                <span class="post-time">
                  <span v-if="post.pinned" class="pinned-badge"><Pin :size="11" />{{ t.pinnedBadge }}</span>
                  {{ formatDateOnly(post.createdAt) }}
                </span>
              </header>

              <div v-if="post.status !== 'APPROVED'" class="status-row">
                <span :class="['status-pill', `status-${post.status.toLowerCase()}`]">
                  {{ statusText(post.status) }}
                </span>
                <span v-if="post.reviewNote" class="status-note">{{ post.reviewNote }}</span>
              </div>

              <p class="post-content">{{ post.content }}</p>

              <div
                v-if="post.images.length"
                :class="['post-images', `images-${post.images.length >= 5 ? 'many' : post.images.length}`]"
              >
                <button
                  v-for="(image, index) in post.images"
                  :key="image.id"
                  class="image-button"
                  type="button"
                  @click="openLightbox(post.images, Number(index))"
                >
                  <img
                    :alt="`图片 ${Number(index) + 1}`"
                    :src="image.thumbUrl ?? image.url"
                    loading="lazy"
                  >
                </button>
              </div>

              <div v-if="post.song" class="song-row">
                <div
                  class="song-cover"
                  :class="{ 'is-playable': canPlaySong(post.song) }"
                  @click.stop="playPostSong(post)"
                >
                  <img v-if="post.song.cover" :alt="post.song.title" :src="post.song.cover">
                  <Music v-else :size="18" />
                  <div v-if="canPlaySong(post.song)" class="play-button-overlay">
                    <Pause v-if="isPlayingSong(post.song)" :size="14" />
                    <Play v-else :size="14" />
                  </div>
                </div>
                <div class="song-info">
                  <span class="song-title">{{ post.song.title }}</span>
                  <span class="song-artist">{{ post.song.artist }}</span>
                  <span v-if="songNoteText(post)" class="song-note">{{ songNoteText(post) }}</span>
                </div>
                <button
                  :class="{ liked: post.song.likedByMe }"
                  class="like-button"
                  :disabled="post.liking || !canToggleLike(post)"
                  :title="likeButtonTitle(post)"
                  type="button"
                  @click="toggleLike(post)"
                >
                  <Heart :fill="post.song.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ post.song.likeCount }}</span>
                </button>
              </div>

              <footer class="post-footer">
                <button class="footer-action" type="button" @click="openDetail(post)">
                  <MessageCircle :size="16" />
                  <span>{{ post.commentCount }}</span>
                </button>
                <span class="footer-action footer-static" :title="t.viewCount">
                  <Eye :size="16" />
                  <span>{{ post.viewCount || 0 }}</span>
                </span>
                <button
                  :class="{ liked: post.likedByMe }"
                  class="footer-action footer-like"
                  :title="post.likedByMe ? t.postLikeCancel : t.postLike"
                  type="button"
                  @click="togglePostLike(post)"
                >
                  <Heart :fill="post.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ post.likeCount || 0 }}</span>
                </button>
                <button
                  v-if="!isOwnPost(post)"
                  class="footer-action"
                  type="button"
                  @click="openReport('POST', post.id, post.content)"
                >
                  <Flag :size="16" />
                  <span>{{ t.report || '举报' }}</span>
                </button>
                <button
                  v-if="feedPermissions.canPin && post.status === 'APPROVED'"
                  class="footer-action"
                  type="button"
                  @click="togglePin(post)"
                >
                  <Pin :size="16" />
                  <span>{{ post.pinned ? t.unpin : t.pin }}</span>
                </button>
                <button
                  v-if="canRemovePost(post)"
                  class="footer-action footer-danger"
                  type="button"
                  @click="askRemovePost(post)"
                >
                  <Trash2 :size="16" />
                  <span>{{ isOwnPost(post) ? t.withdraw : t.deleteContent }}</span>
                </button>
              </footer>
            </article>

            <div v-if="nextCursor && sortMode === 'latest'" class="load-more-row">
              <button :disabled="feedLoading" class="ghost-button" type="button" @click="loadFeed()">
                <Loader2 v-if="feedLoading" class="animate-spin" :size="16" />
                <span>{{ t.loadMore }}</span>
              </button>
            </div>
          </div>
        </main>

        <aside class="community-aside">
          <section class="me-card">
            <div class="me-identity">
              <div class="me-avatar">
                <UserRound :size="20" />
              </div>
              <div>
                <p class="me-name">{{ me?.user?.displayName || '—' }}</p>
                <p v-if="me?.user?.title" class="me-title">{{ me.user.title }}</p>
              </div>
            </div>
            <div class="me-stats">
              <div>
                <span class="me-stat-value">{{ me?.stats?.posts ?? 0 }}</span>
                <span class="me-stat-label">{{ t.postCount }}</span>
              </div>
              <div>
                <span class="me-stat-value">{{ me?.stats?.comments ?? 0 }}</span>
                <span class="me-stat-label">{{ t.commentCount }}</span>
              </div>
            </div>
            <p v-if="violationCount > 0" class="me-violation">
              {{ t.violationCount(violationCount) }}
            </p>
            <NuxtLink class="me-link" to="/account">
              <span>{{ t.accountEntry }}</span>
              <ArrowRight :size="14" />
            </NuxtLink>
          </section>

          <NowPlayingCard v-if="isOpen" />

          <section class="rules-card">
            <h3>{{ t.rulesTitle }}</h3>
            <p>{{ t.pendingHint }}</p>
            <p v-if="settings.allowImages">{{ imageHintText }}</p>
          </section>
        </aside>
      </div>
    </template>

    <!-- 发帖 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="publishOpen" class="modal-layer" @click.self="closePublish">
          <div class="modal-card publish-card">
            <header class="modal-head">
              <div>
                <h3>{{ t.publishTitle }}</h3>
                <p>{{ t.publishDesc }}</p>
              </div>
              <button class="icon-button" type="button" @click="closePublish">
                <X :size="18" />
              </button>
            </header>

            <div class="modal-body">
              <div class="publish-as">
                <span class="publish-as-label">{{ t.publishAs }}</span>
                <span class="publish-as-name">{{ me?.user?.displayName || '—' }}</span>
              </div>

              <div v-if="nameModeOptions.length" class="field">
                <div class="field-title">
                  <UserRound :size="15" />
                  <span>{{ t.nameMode?.label }}</span>
                </div>
                <div class="board-picker">
                  <button
                    v-for="option in nameModeOptions"
                    :key="option.value"
                    :class="{ active: publishForm.nameMode === option.value }"
                    class="board-chip"
                    type="button"
                    @click="publishForm.nameMode = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div class="board-picker">
                <button
                  v-for="board in activeBoards"
                  :key="board.id"
                  :class="{ active: publishForm.boardId === board.id }"
                  class="board-chip"
                  type="button"
                  @click="publishForm.boardId = board.id"
                >
                  {{ board.name }}
                </button>
              </div>

              <div class="field">
                <textarea
                  v-model="publishForm.content"
                  :maxlength="settings.maxContentLength"
                  :placeholder="t.contentPlaceholder"
                  rows="5"
                />
                <div class="field-meta">
                  <span>{{ t.pendingHint }}</span>
                  <span>{{ publishForm.content.length }}/{{ settings.maxContentLength }}</span>
                </div>
              </div>

              <div class="field">
                <div class="field-title">
                  <Music :size="15" />
                  <span>{{ t.attachSong }}</span>
                </div>

                <div v-if="publishForm.song" class="selected-song">
                  <div class="song-cover">
                    <img
                      v-if="publishForm.song.cover"
                      :alt="publishForm.song.title"
                      :src="publishForm.song.cover"
                    >
                    <Music v-else :size="18" />
                  </div>
                  <div class="song-info">
                    <span class="song-title">{{ publishForm.song.title }}</span>
                    <span class="song-artist">{{ publishForm.song.artist }}</span>
                    <span v-if="songBlockedText(publishForm.song)" class="song-note">
                      {{ songBlockedText(publishForm.song) }}
                    </span>
                  </div>
                  <button class="link-button" type="button" @click="publishForm.song = null">
                    {{ t.remove }}
                  </button>
                </div>

                <template v-else>
                  <div class="search-field">
                    <Search :size="15" />
                    <input
                      v-model="songQuery"
                      :placeholder="t.searchSong"
                      type="text"
                      @input="handleSongInput"
                    >
                  </div>
                  <div v-if="songResults.length" class="song-results">
                    <button
                      v-for="song in songResults"
                      :key="song.id"
                      class="song-result"
                      type="button"
                      @click="chooseSong(song)"
                    >
                      <span class="song-result-title">{{ song.title }}</span>
                      <span class="song-result-artist">{{ song.artist }}</span>
                      <span v-if="song.isOwn" class="song-result-own">{{ t.ownSubmission }}</span>
                      <span v-if="song.likedByMe" class="song-result-liked">{{ t.alreadyLiked }}</span>
                      <span
                        v-if="songBlockedText(song)"
                        class="song-result-blocked"
                        :title="songBlockedText(song)"
                      >
                        {{ t.cannotLike }}
                      </span>
                      <span class="song-result-pick">{{ t.choose }}</span>
                    </button>
                  </div>
                  <p v-else-if="songQuery && songSearched" class="muted-text">{{ t.noSongFound }}</p>
                  <p class="field-hint">{{ t.attachSongHint }}</p>
                </template>
              </div>

              <div v-if="settings.allowImages" class="field">
                <div class="field-title">
                  <ImagePlus :size="15" />
                  <span>{{ t.addImages }}</span>
                  <span class="field-title-extra">
                    {{ publishForm.images.length }}<template v-if="!batchEnabled">/{{ maxImages }}</template>
                  </span>
                </div>
                <div class="image-uploader">
                  <div
                    v-for="(image, index) in publishForm.images"
                    :key="image.key"
                    class="upload-thumb"
                    :class="{ 'is-pending': !image.id }"
                  >
                    <img :alt="`已选图片 ${Number(index) + 1}`" :src="image.previewUrl ?? image.thumbUrl ?? image.url">
                    <span v-if="!image.id" class="thumb-pending">{{ t.uploading }}</span>
                    <button class="thumb-remove" type="button" @click="removeImage(image.key)">
                      <X :size="12" />
                    </button>
                  </div>
                  <button
                    v-if="publishForm.images.length < imageSelectionLimit"
                    class="upload-add"
                    :disabled="isUploading"
                    type="button"
                    @click="imageInput?.click()"
                  >
                    <Loader2 v-if="isUploading" class="animate-spin" :size="18" />
                    <ImagePlus v-else :size="18" />
                    <span>{{ isUploading ? uploadingLabel : t.addImages }}</span>
                  </button>
                </div>
                <div v-if="uploadProgress" class="upload-progress">
                  <div class="upload-progress-track">
                    <div
                      class="upload-progress-bar"
                      :style="{ width: `${uploadProgress.total ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0}%` }"
                    />
                  </div>
                  <span>{{ uploadingLabel }}</span>
                  <button v-if="isUploading" class="link-button" type="button" @click="stopUpload">
                    {{ t.imageUploadAborted }}
                  </button>
                </div>
                <button
                  v-if="!isUploading && uploadFailedCount > 0"
                  class="link-button upload-retry"
                  type="button"
                  @click="retryFailedImages"
                >
                  {{ t.imageUploadRetry }}
                </button>
                <p v-if="batchEnabled && batchPostCount > 1" class="field-hint">
                  {{ t.batchPostCount(batchPostCount) }}
                </p>
                <p class="field-hint">{{ imageHintText }}</p>
                <p v-if="!publishForm.content.trim()" class="field-hint">{{ t.imageOnlyHint }}</p>
                <div v-if="draftSaveFailed" class="field-hint">{{ t.draftSaveFailed }}</div>
                <input
                  ref="imageInput"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  class="hidden-input"
                  multiple
                  type="file"
                  @change="handleImageSelect"
                >
              </div>
              <p v-else class="field-hint">{{ t.imagesDisabled }}</p>
            </div>

            <footer v-if="discardConfirming" class="modal-foot discard-confirm">
              <span class="foot-hint">{{ t.draftDiscardConfirm }}</span>
              <div class="foot-actions">
                <button class="ghost-button" :disabled="discarding" type="button" @click="discardConfirming = false">
                  {{ t.cancel || '取消' }}
                </button>
                <button class="primary-button" :disabled="discarding" type="button" @click="confirmDiscardDraft">
                  {{ t.draftDiscard }}
                </button>
              </div>
            </footer>
            <footer v-else class="modal-foot">
              <span class="foot-hint">{{ draftRestored ? t.draftRestored : t.pendingHint }}</span>
              <div class="foot-actions">
                <button
                  v-if="hasDraftContent"
                  class="ghost-button"
                  :disabled="submitting || isUploading || discarding"
                  type="button"
                  @click="discardConfirming = true"
                >
                  {{ t.draftDiscard }}
                </button>
                <button class="ghost-button" type="button" @click="closePublish">
                  {{ t.cancel || '取消' }}
                </button>
                <button
                  class="primary-button"
                  :disabled="!canSubmit"
                  type="button"
                  @click="submitPost"
                >
                  <Loader2 v-if="submitting" class="animate-spin" :size="16" />
                  <span>{{ submitting ? t.submitting : t.submit }}</span>
                </button>
              </div>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 帖子详情 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="detailOpen && selectedPost" class="modal-layer" @click.self="closeDetail">
          <div class="modal-card detail-card">
            <header class="modal-head">
              <div class="detail-head-main">
                <span class="identity-board">{{ selectedPost.board.name }}</span>
                <span v-if="selectedPost.status !== 'APPROVED'" :class="['status-pill', `status-${selectedPost.status.toLowerCase()}`]">
                  {{ statusText(selectedPost.status) }}
                </span>
              </div>
              <div class="detail-head-actions">
                <button
                  v-if="canRemovePost(selectedPost)"
                  class="ghost-button detail-remove"
                  type="button"
                  @click="askRemovePost(selectedPost)"
                >
                  <Trash2 :size="14" />
                  <span>{{ isOwnPost(selectedPost) ? t.withdraw : t.deleteContent }}</span>
                </button>
                <button class="icon-button" type="button" @click="closeDetail">
                  <X :size="18" />
                </button>
              </div>
            </header>

            <div class="modal-body detail-body">
              <button class="identity detail-identity" type="button" @click="openProfile(selectedPost.author.id)">
                <span class="identity-name">{{ selectedPost.author.displayName }}</span>
                <span class="identity-meta">
                  <span v-if="selectedPost.author.title" class="identity-title">
                    {{ selectedPost.author.title }}
                  </span>
                  <span class="post-time">{{ formatDateOnly(selectedPost.createdAt) }}</span>
                </span>
              </button>

              <p class="post-content detail-content">{{ selectedPost.content }}</p>

              <div
                v-if="selectedPost.images.length"
                :class="['post-images', `images-${selectedPost.images.length >= 5 ? 'many' : selectedPost.images.length}`]"
              >
                <button
                  v-for="(image, index) in selectedPost.images"
                  :key="image.id"
                  class="image-button"
                  type="button"
                  @click="openLightbox(selectedPost.images, Number(index))"
                >
                  <img
                    :alt="`图片 ${Number(index) + 1}`"
                    :src="image.thumbUrl ?? image.url"
                    loading="lazy"
                  >
                </button>
              </div>

              <div v-if="selectedPost.song" class="song-row">
                <div
                  class="song-cover"
                  :class="{ 'is-playable': canPlaySong(selectedPost.song) }"
                  @click.stop="playPostSong(selectedPost)"
                >
                  <img
                    v-if="selectedPost.song.cover"
                    :alt="selectedPost.song.title"
                    :src="selectedPost.song.cover"
                  >
                  <Music v-else :size="18" />
                  <div v-if="canPlaySong(selectedPost.song)" class="play-button-overlay">
                    <Pause v-if="isPlayingSong(selectedPost.song)" :size="14" />
                    <Play v-else :size="14" />
                  </div>
                </div>
                <div class="song-info">
                  <span class="song-title">{{ selectedPost.song.title }}</span>
                  <span class="song-artist">{{ selectedPost.song.artist }}</span>
                  <span v-if="songNoteText(selectedPost)" class="song-note">
                    {{ songNoteText(selectedPost) }}
                  </span>
                </div>
                <button
                  :class="{ liked: selectedPost.song.likedByMe }"
                  class="like-button"
                  :disabled="selectedPost.liking || !canToggleLike(selectedPost)"
                  :title="likeButtonTitle(selectedPost)"
                  type="button"
                  @click="toggleLike(selectedPost)"
                >
                  <Heart :fill="selectedPost.song.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ selectedPost.song.likeCount }}</span>
                </button>
              </div>

              <div class="detail-actions">
                <span class="footer-action footer-static">
                  <Eye :size="16" />
                  <span>{{ selectedPost.viewCount || 0 }}</span>
                </span>
                <button
                  :class="{ liked: selectedPost.likedByMe }"
                  class="footer-action footer-like"
                  type="button"
                  @click="togglePostLike(selectedPost)"
                >
                  <Heart :fill="selectedPost.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ selectedPost.likeCount || 0 }}</span>
                </button>
                <button
                  v-if="feedPermissions.canPin && selectedPost.status === 'APPROVED'"
                  class="footer-action"
                  type="button"
                  @click="togglePin(selectedPost)"
                >
                  <Pin :size="16" />
                  <span>{{ selectedPost.pinned ? t.unpin : t.pin }}</span>
                </button>
              </div>

              <div v-if="selectedPost.reviewNote" class="detail-note">
                <span>{{ t.reviewNoteLabel }}</span>
                <p>{{ selectedPost.reviewNote }}</p>
              </div>

              <div class="comment-section">
                <h4>{{ t.comments }} · {{ selectedPost.commentCount }}</h4>
                <div v-if="commentsLoading" class="feed-state">
                  <Loader2 class="animate-spin" :size="20" />
                </div>
                <div v-else-if="!comments.length" class="comment-empty">{{ t.noComments }}</div>
                <div v-else class="comment-list">
                  <CommunityCommentItem
                    v-for="thread in threads"
                    :key="thread.id"
                    :comment="thread"
                    :my-user-id="myUserId"
                    :can-review="canReview"
                    :can-reply="selectedPost.status === 'APPROVED' && !ban.muted"
                    @reply="startReply"
                    @remove="askRemoveComment"
                    @report="reportComment"
                    @like="toggleCommentLike"
                    @profile="openProfile"
                  />
                </div>
                <div v-if="commentsHasMore" class="load-more-row comment-load-more">
                  <button
                    :disabled="commentsLoadingMore"
                    class="ghost-button"
                    type="button"
                    @click="loadMoreComments"
                  >
                    <Loader2 v-if="commentsLoadingMore" class="animate-spin" :size="16" />
                    <span>{{ commentsLoadingMore ? (t.loading || '正在加载…') : (t.loadMore || '加载更多') }}</span>
                  </button>
                </div>
              </div>
            </div>

            <footer class="comment-foot">
              <template v-if="selectedPost.status === 'APPROVED' && !ban.muted && !isGuest">
                <div v-if="replyTo" class="reply-chip">
                  <span>回复 {{ replyTo.author?.displayName || '' }}</span>
                  <button type="button" @click="cancelReply">
                    <X :size="12" />
                  </button>
                </div>
                <input
                  v-model="commentContent"
                  :maxlength="settings.maxCommentLength"
                  :placeholder="
                    replyTo
                      ? String(t.replyPlaceholder || '回复 @{name}…').replace('{name}', replyTo.author?.displayName || '')
                      : t.commentPlaceholder
                  "
                  class="comment-input"
                  type="text"
                  @keyup.enter="sendComment"
                >
                <button
                  class="primary-button comment-send"
                  :disabled="sendingComment || !commentContent.trim()"
                  type="button"
                  @click="sendComment"
                >
                  <Loader2 v-if="sendingComment" class="animate-spin" :size="16" />
                  <Send v-else :size="16" />
                  <span>{{ t.sendComment }}</span>
                </button>
              </template>
              <p v-else-if="isGuest" class="foot-hint">{{ t.guestViewOnly }}</p>
              <p v-else class="foot-hint">
                {{ ban.muted ? t.muted : t.pendingHint }}
              </p>
              <p v-if="selectedPost.status === 'APPROVED' && !ban.muted && !isGuest" class="mention-hint">
                {{ t.mentionHint || '输入 @用户名 可以提醒同学' }}
              </p>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 个人主页 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="profileOpen" class="modal-layer" @click.self="closeProfile">
          <div class="modal-card profile-card">
            <header class="modal-head">
              <h3>{{ t.viewProfile }}</h3>
              <button class="icon-button" type="button" @click="closeProfile">
                <X :size="18" />
              </button>
            </header>
            <div class="modal-body">
              <div v-if="profileLoading" class="feed-state">
                <Loader2 class="animate-spin" :size="22" />
              </div>
              <template v-else-if="profile">
                <div class="profile-identity">
                  <div class="me-avatar profile-avatar">
                    <UserRound :size="26" />
                  </div>
                  <div>
                    <p class="profile-name">{{ profile.user.displayName }}</p>
                    <p v-if="profile.user.title" class="me-title">{{ profile.user.title }}</p>
                    <p v-if="profile.user.joinedAt" class="profile-joined">
                      {{ t.joinedAt }} {{ formatDateOnly(profile.user.joinedAt) }}
                    </p>
                  </div>
                </div>

                <div class="profile-stats">
                  <div>
                    <span class="me-stat-value">{{ profile.stats.posts }}</span>
                    <span class="me-stat-label">{{ t.postCount }}</span>
                  </div>
                  <div>
                    <span class="me-stat-value">{{ profile.stats.comments }}</span>
                    <span class="me-stat-label">{{ t.commentCount }}</span>
                  </div>
                </div>

                <div v-if="profile.user && !profile.isSelf" class="profile-actions">
                  <BlockButton :user-id="profile.user.id" :display-name="profile.user.displayName" @done="onBlockDone" />
                  <button class="ghost-button" type="button" @click="openReport('USER', profile.user.id, profile.user.displayName)">
                    <Flag :size="14" />
                    <span>{{ t.report || '举报' }}</span>
                  </button>
                </div>

                <UserAchievement v-if="profile.user?.id" :user-id="profile.user.id" />

                <section class="profile-section">
                  <h4>{{ t.favoriteSong }}</h4>
                  <div v-if="profile.favoriteSong" class="song-row">
                    <div class="song-cover">
                      <img
                        v-if="profile.favoriteSong.cover"
                        :alt="profile.favoriteSong.title"
                        :src="profile.favoriteSong.cover"
                      >
                      <Music v-else :size="18" />
                    </div>
                    <div class="song-info">
                      <span class="song-title">{{ profile.favoriteSong.title }}</span>
                      <span class="song-artist">{{ profile.favoriteSong.artist }}</span>
                    </div>
                  </div>
                  <p v-else class="muted-text">{{ t.notPublic }}</p>
                </section>

                <section class="profile-section">
                  <h4>{{ t.likedSongs }}</h4>
                  <div v-if="profile.likedSongs && profile.likedSongs.length" class="liked-list">
                    <div v-for="song in profile.likedSongs" :key="song.id" class="liked-item">
                      <div class="song-cover liked-cover">
                        <img v-if="song.cover" :alt="song.title" :src="song.cover">
                        <Music v-else :size="14" />
                      </div>
                      <span class="song-title">{{ song.title }}</span>
                      <span class="song-artist">{{ song.artist }}</span>
                    </div>
                  </div>
                  <p v-else-if="profile.likedSongs" class="muted-text">{{ t.noLikedSongs }}</p>
                  <p v-else class="muted-text">{{ t.notPublic }}</p>
                </section>

                <button v-if="profile.isSelf" class="ghost-button profile-account-link" type="button" @click="goAccount">
                  <span>{{ t.accountEntry }}</span>
                  <ArrowRight :size="14" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 图片查看器：微信朋友圈式缩放 / 查看原图 / 下载（游客与登录用户均可下载） -->
    <CommunityImageViewer
      :open="lightbox.open"
      :images="lightbox.images"
      :index="lightbox.index"
      :can-download="true"
      @close="closeLightbox"
      @update:index="lightbox.index = $event"
      @need-login="requireLogin"
    />

    <!-- 点赞署名选择：匿名 or 署名 -->
    <RevealChoiceDialog
      :show="!!pendingLikePost"
      @confirm="onLikeRevealConfirm"
      @cancel="cancelLikeReveal"
    />

    <RevealChoiceDialog
      :show="!!pendingPostLike"
      @confirm="onPostLikeRevealConfirm"
      @cancel="pendingPostLike = null"
    />

    <RevealChoiceDialog
      :show="!!pendingCommentLike"
      @confirm="onCommentLikeRevealConfirm"
      @cancel="pendingCommentLike = null"
    />

    <ReportDialog
      v-model:show="reportState.show"
      :target-type="reportState.targetType"
      :target-id="reportState.targetId"
      :target-label="reportState.targetLabel"
      @done="onReportDone"
    />

    <ConfirmDialog
      v-model:show="removeConfirm.show"
      :title="removeConfirm.title"
      :message="removeConfirm.message"
      :type="'danger'"
      :loading="removeConfirm.loading"
      :show-input="removeConfirm.isDelete"
  :input-required="false"
      :input-placeholder="t.removeReasonPlaceholder"
      @confirm="runRemove"
      @cancel="removeConfirm.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  Flag,
  Heart,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  MessageCircle,
  Music,
  Pause,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import ReportDialog from '~/components/Community/ReportDialog.vue'
import BlockButton from '~/components/Community/BlockButton.vue'
import NotificationCenter from '~/components/Notifications/NotificationCenter.vue'
import NowPlayingCard from '~/components/Community/NowPlayingCard.vue'
import CommunityCommentItem from '~/components/Community/CommunityCommentItem.vue'
import RevealChoiceDialog from '~/components/Community/RevealChoiceDialog.vue'
import UserAchievement from '~/components/Community/UserAchievement.vue'
import { useLocale } from '~/utils/locale'
import { useNewUi } from '~/composables/useNewUi'
import { useToast } from '~/composables/useToast'
import { useSongPlayback } from '~/composables/useSongPlayback'
import {
  COMMUNITY_DRAFT_MAX_IMAGES,
  collectUploadedImageIds,
  makeDraftImageKey,
  markDraftUploaded,
  mergeDraftImages,
  type DraftImage,
  type PublishDraft
} from '~/utils/communityPublishDraft'
import {
  prepareImageFile,
  uploadDraftImages,
  type UploadProgress
} from '~/utils/communityImageUpload'
import {
  clearDraftBlobs,
  clearDraftMeta,
  restoreDraft,
  saveDraftBlobs,
  saveDraftMeta
} from '~/utils/communityDraftStore'
import CommunityImageViewer from '~/components/Community/CommunityImageViewer.vue'
import { formatDateOnly } from '~/utils/timeUtils'

type AnyRecord = Record<string, any>

const { community: communityLocale } = useLocale()
const t = computed<AnyRecord>(() => communityLocale.value || {})
const uiT = useNewUi()
const { showToast } = useToast()

const loading = ref(true)
const fatalError = ref('')
const status = ref<AnyRecord | null>(null)
const me = ref<AnyRecord | null>(null)
const boards = ref<AnyRecord[]>([])
const posts = ref<AnyRecord[]>([])
const feedListRef = ref<HTMLElement | null>(null)
const activeBoardId = ref(0)
const filterMine = ref(false)
const feedLoading = ref(false)
const nextCursor = ref<number | null>(null)
const feedPermissions = reactive({ canPin: false })
const searchQuery = ref('')
const sortMode = ref<'latest' | 'hot'>('latest')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const settings = computed<AnyRecord>(
  () =>
    status.value?.settings || {
      enabled: false,
      allowImages: false,
      allowMultiImageBatch: false,
      maxImages: 9,
      maxContentLength: 1000,
      maxCommentLength: 300
    }
)
const canReview = computed(() => !!status.value?.viewer?.canReview)
const isOpen = computed(() => !!settings.value.enabled || canReview.value)
const ban = computed<AnyRecord>(
  () => status.value?.viewer?.ban || { muted: false, permanent: false, until: null, reason: null }
)
const violationCount = computed(() => Number(status.value?.viewer?.violationCount || 0))
const activeBoards = computed(() => boards.value.filter((board) => board.isActive))
const maxImages = computed(() => Math.min(Number(settings.value.maxImages || 9), 9))
// 开关只控制「是否允许超过单帖上限并自动拆帖」；其余上传优化始终启用
const batchEnabled = computed(() => settings.value.allowMultiImageBatch === true)
const imageSelectionLimit = computed(() =>
  batchEnabled.value ? COMMUNITY_DRAFT_MAX_IMAGES : maxImages.value
)
const imageHintText = computed(() => {
  const hint = batchEnabled.value ? t.value.imageHintBatch : t.value.imageHint
  return typeof hint === 'function' ? hint(maxImages.value) : ''
})
const myUserId = computed(() => Number(me.value?.user?.id || 0))
// 未登录游客：可浏览内容与图片、查看原图与下载，但发帖/评论/点赞等写操作一律拦截（服务端同步强校验）
const isGuest = computed(() => myUserId.value <= 0)
function requireLogin(): boolean {
  if (!isGuest.value) return false
  showToast(t.value.guestLoginRequired || '请先登录后再操作', 'warning')
  return true
}

function isOwnPost(post: AnyRecord | null) {
  return !!post && Number(post.author?.id) === myUserId.value && myUserId.value > 0
}

function isOwnComment(comment: AnyRecord | null) {
  return !!comment && Number(comment.author?.id) === myUserId.value && myUserId.value > 0
}

const reportState = reactive<{
  show: boolean
  targetType: 'POST' | 'COMMENT' | 'USER'
  targetId: number
  targetLabel: string
}>({ show: false, targetType: 'POST', targetId: 0, targetLabel: '' })

function openReport(targetType: 'POST' | 'COMMENT' | 'USER', targetId: number, label?: string) {
  if (requireLogin()) return
  reportState.targetType = targetType
  reportState.targetId = Number(targetId)
  reportState.targetLabel = String(label || '').slice(0, 40)
  reportState.show = true
}

function onReportDone() {
  showToast(t.value.reportSuccess || '举报已提交，等待管理员处理', 'success')
}

function onBlockDone() {
  showToast(t.value.blockSuccess || '已更新拉黑状态', 'success')
}

function canRemovePost(post: AnyRecord | null) {
  if (!post) return false
  return isOwnPost(post) || canReview.value
}

function canRemoveComment(comment: AnyRecord | null) {
  if (!comment) return false
  return isOwnComment(comment) || canReview.value
}

const publishOpen = ref(false)
const submitting = ref(false)
const imageInput = ref<HTMLInputElement | null>(null)
const uploadProgress = ref<UploadProgress | null>(null)
const isUploading = ref(false)
const uploadFailedCount = ref(0)
const draftRestored = ref(false)
const draftSaveFailed = ref(false)
const discardConfirming = ref(false)
// 放弃草稿是异步流程（先清服务端孤儿图，再清本地草稿）：期间保持确认态并禁用按钮，
// 避免用户在清理完成前刷新页面恢复出已被删除的图片，或重复触发清理
const discarding = ref(false)
let abortUpload = false
let uploadToken = 0
const publishForm = reactive<AnyRecord>({
  boardId: 0,
  content: '',
  song: null as AnyRecord | null,
  images: [] as DraftImage[],
  nameMode: 'semi'
})
// 发帖显示模式：受后台三个开关约束，semi 为默认；开关缺省（后端尚未下发）时按允许处理
const nameModeOptions = computed(() => {
  const nm = t.value.nameMode || {}
  const options: AnyRecord[] = []
  if (settings.value.allowSemi !== false) options.push({ value: 'semi', label: nm.semi })
  if (settings.value.allowRealname !== false) options.push({ value: 'real', label: nm.real })
  if (settings.value.allowAnonymous !== false) options.push({ value: 'anon', label: nm.anon })
  return options
})
// 纯图帖允许发布；上传进行中禁止提交，避免只发出半批图
const canSubmit = computed(
  () =>
    !!publishForm.boardId &&
    publishForm.content.length <= settings.value.maxContentLength &&
    (!!publishForm.content.trim() || collectUploadedImageIds(publishForm.images as DraftImage[]).length > 0) &&
    !isUploading.value &&
    !submitting.value
)
// 批量开关开启且图片超过单帖上限时，提示将拆成几个帖子
const batchPostCount = computed(() => {
  if (!batchEnabled.value) return 1
  return Math.max(1, Math.ceil(collectUploadedImageIds(publishForm.images as DraftImage[]).length / maxImages.value))
})
const uploadingLabel = computed(() => {
  const progress = uploadProgress.value
  if (!progress) return t.value.uploading
  if (progress.phase === 'compressing') return t.value.imageUploadProgress?.(progress.done, progress.total) || t.value.uploading
  return t.value.imageUploadProgress?.(progress.done, progress.total) || t.value.uploading
})

const songQuery = ref('')
const songResults = ref<AnyRecord[]>([])
const songSearched = ref(false)
let songTimer: ReturnType<typeof setTimeout> | null = null
let songSearchSeq = 0

const detailOpen = ref(false)
const selectedPost = ref<AnyRecord | null>(null)
const comments = ref<AnyRecord[]>([])
const threads = ref<AnyRecord[]>([])
const commentsLoading = ref(false)
const commentsLoadingMore = ref(false)
const commentCursor = ref<number | null>(null)
const commentsHasMore = ref(false)
const COMMENT_PAGE_SIZE = 10
const commentContent = ref('')
const sendingComment = ref(false)
const replyTo = ref<AnyRecord | null>(null)
const mentionHint = computed(() => Boolean(t.value.mentionHint))

const voteRevealMode = ref('ASK')
const pendingLikePost = ref<AnyRecord | null>(null)
const pendingPostLike = ref<AnyRecord | null>(null)
const pendingCommentLike = ref<AnyRecord | null>(null)
const pendingRevealChoice = ref('ANONYMOUS')
const pendingRememberChoice = ref(false)

const profileOpen = ref(false)
const profileLoading = ref(false)
const profile = ref<AnyRecord | null>(null)

const lightbox = reactive<{ open: boolean; images: AnyRecord[]; index: number }>({
  open: false,
  images: [],
  index: 0
})

const removeConfirm = reactive({
  show: false,
  loading: false,
  title: '',
  message: '',
  isDelete: false,
  kind: '' as 'post' | 'comment' | '',
  target: null as AnyRecord | null
})

function apiMessage(error: any, fallback: string) {
  return (
    error?.data?.message ||
    error?.data?.statusMessage ||
    error?.statusMessage ||
    error?.message ||
    fallback
  )
}

function statusText(value: string) {
  const map: Record<string, string> = {
    PENDING: t.value.statusPending,
    APPROVED: t.value.statusApproved,
    REJECTED: t.value.statusRejected,
    BLOCKED: t.value.statusBlocked
  }
  return map[value] || value
}

async function init() {
  loading.value = true
  fatalError.value = ''
  try {
    const [statusRes, meRes] = await Promise.all([
      $fetch<AnyRecord>('/api/community/status'),
      // 游客访问 /me 会 401，容错为 null，保证只读浏览不受影响
      $fetch<AnyRecord>('/api/community/me').catch(() => null)
    ])
    status.value = statusRes
    me.value = meRes
    void loadVoteRevealMode()
    if (!isOpen.value) return
    const boardsRes = await $fetch<AnyRecord>('/api/community/boards')
    boards.value = boardsRes.boards || []
    await loadFeed(true)
  } catch (error: any) {
    fatalError.value = apiMessage(error, t.value.loadFailed)
  } finally {
    loading.value = false
  }
}

async function loadFeed(reset = false) {
  if (feedLoading.value) return
  if (reset) {
    posts.value = []
    nextCursor.value = null
  }
  feedLoading.value = true
  try {
    const query: AnyRecord = { limit: 20, sort: sortMode.value }
    if (activeBoardId.value) query.boardId = activeBoardId.value
    if (filterMine.value) query.mine = '1'
    if (searchQuery.value.trim()) query.q = searchQuery.value.trim()
    if (!reset && nextCursor.value && sortMode.value === 'latest') query.beforeId = nextCursor.value
    const res = await $fetch<AnyRecord>('/api/community/posts', { query })
    const list = (res.posts || []) as AnyRecord[]
    posts.value = reset ? list : [...posts.value, ...list]
    nextCursor.value = res.nextCursor ?? null
    feedPermissions.canPin = Boolean(res.permissions?.canPin)
    await nextTick()
    observePostCards()
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    feedLoading.value = false
  }
}

/**
 * 列表曝光计浏览：卡片在视口里停留满 1 秒就算「在外面看过」，上报后小眼睛就地 +1。
 * 后端与详情页共用同一套去重口径（登录用户永久去重、游客按小时桶），
 * 所以从列表点进详情不会重复计数，同一个人反复刷列表也不会一直涨。
 * 上报按批合并（最多 40 条一次），失败静默——统计不能影响阅读。
 */
const IMPRESSION_DWELL_MS = 1000
const IMPRESSION_FLUSH_MS = 1200
const IMPRESSION_BATCH_MAX = 40
/** 卡片异步渲染的兜底重试上限：20 次 × 300ms */
const MAX_OBSERVE_RETRY = 20
let impressionObserver: IntersectionObserver | null = null
let feedCardsObserver: MutationObserver | null = null
let feedCardsTarget: HTMLElement | null = null
const impressionTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
const pendingViewIds = new Set<number>()
const reportedViewIds = new Set<number>()
let viewFlushTimer: ReturnType<typeof setTimeout> | null = null

function queuePostView(postId: number) {
  if (reportedViewIds.has(postId) || pendingViewIds.has(postId)) return
  pendingViewIds.add(postId)
  if (viewFlushTimer) return
  viewFlushTimer = setTimeout(() => {
    viewFlushTimer = null
    flushPostViews().catch(() => {})
  }, IMPRESSION_FLUSH_MS)
}

async function flushPostViews() {
  if (!pendingViewIds.size) return
  const ids = [...pendingViewIds].slice(0, IMPRESSION_BATCH_MAX)
  for (const id of ids) {
    pendingViewIds.delete(id)
    reportedViewIds.add(id)
  }
  try {
    const res = await $fetch<AnyRecord>('/api/community/posts/views', {
      method: 'POST',
      body: { ids }
    })
    const counts = (res?.viewCounts || {}) as Record<string, number>
    for (const [rawId, count] of Object.entries(counts)) {
      const id = Number(rawId)
      const post = posts.value.find((item) => item.id === id)
      if (post) post.viewCount = Number(count)
      if (selectedPost.value?.id === id) selectedPost.value.viewCount = Number(count)
    }
  } catch {
    // 上报失败允许下次曝光再试，不提示用户
    for (const id of ids) reportedViewIds.delete(id)
  }
  if (pendingViewIds.size) {
    if (!viewFlushTimer) {
      viewFlushTimer = setTimeout(() => {
        viewFlushTimer = null
        flushPostViews().catch(() => {})
      }, IMPRESSION_FLUSH_MS)
    }
  }
}

/** 卡片是否算「看得见」：常规卡片露出 50%，比屏幕还高的长帖露出屏幕 60% 也算 */
function isCardVisible(entry: IntersectionObserverEntry) {
  if (!entry.isIntersecting) return false
  const cardHeight = entry.boundingClientRect.height || 1
  const viewportHeight = typeof window === 'undefined' ? 1 : window.innerHeight || 1
  return entry.intersectionRect.height >= Math.min(cardHeight * 0.5, viewportHeight * 0.6)
}

/** 把容器里已渲染的卡片挂到观察器上，返回卡片数量 */
function watchRenderedCards(container: HTMLElement) {
  const cards = container.querySelectorAll<HTMLElement>('[data-post-id]')
  cards.forEach((el) => {
    const postId = Number(el.dataset.postId)
    if (!postId || reportedViewIds.has(postId)) return
    impressionObserver?.observe(el)
  })
  return cards.length
}

/**
 * 只观察当前渲染出来的卡片；已上报过的直接跳过，避免重复建观察。
 * 卡片由异步数据渲染，容器与卡片可能晚一两帧出现：先挂 MutationObserver，
 * 卡片插入即观察；再保留短轮询兜底，避免极端情况下整页一次都不计数。
 */
function observePostCards(retry = 0) {
  if (typeof IntersectionObserver === 'undefined') return
  // 优先用模板 ref；ref 尚未就绪时退回到文档查询，保证卡片一定能被观察
  const container =
    feedListRef.value ||
    (typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.feed-list') : null)
  if (!container) {
    if (retry < MAX_OBSERVE_RETRY) setTimeout(() => observePostCards(retry + 1), 300)
    return
  }
  if (!impressionObserver) {
    impressionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const postId = Number(target.dataset.postId)
          if (!postId) continue
          if (!isCardVisible(entry)) {
            const timer = impressionTimers.get(target)
            if (timer) {
              clearTimeout(timer)
              impressionTimers.delete(target)
            }
            continue
          }
          if (impressionTimers.has(target) || reportedViewIds.has(postId)) continue
          const timer = setTimeout(() => {
            impressionTimers.delete(target)
            impressionObserver?.unobserve(target)
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
            if (!target.isConnected) return
            queuePostView(postId)
          }, IMPRESSION_DWELL_MS)
          impressionTimers.set(target, timer)
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
  }
  // 容器被重建（切换板块、分页重置）时重新挂观察目标
  if (feedCardsTarget !== container) {
    feedCardsObserver?.disconnect()
    feedCardsObserver = null
    feedCardsTarget = null
    if (typeof MutationObserver !== 'undefined') {
      feedCardsObserver = new MutationObserver(() => watchRenderedCards(container))
      feedCardsObserver.observe(container, { childList: true, subtree: true })
      feedCardsTarget = container
    }
  }
  if (!watchRenderedCards(container) && retry < MAX_OBSERVE_RETRY) {
    setTimeout(() => observePostCards(retry + 1), 300)
  }
}

function stopImpressions() {
  impressionObserver?.disconnect()
  impressionObserver = null
  feedCardsObserver?.disconnect()
  feedCardsObserver = null
  feedCardsTarget = null
  if (viewFlushTimer) {
    clearTimeout(viewFlushTimer)
    viewFlushTimer = null
  }
  // 组件卸载时把未上报的曝光发出去，失败也不阻塞卸载
  flushPostViews().catch(() => {})
}

function selectBoard(boardId: number) {
  if (activeBoardId.value === boardId) return
  activeBoardId.value = boardId
  loadFeed(true)
}

function toggleMine() {
  filterMine.value = !filterMine.value
  loadFeed(true)
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadFeed(true), 350)
}

function setSort(mode: 'latest' | 'hot') {
  if (sortMode.value === mode) return
  sortMode.value = mode
  loadFeed(true)
}

/** 帖子点赞（与歌曲点赞独立） */
// 歌曲播放与投稿列表共用同一套逻辑：社区没有列表概念，只播放当前这一首
const {
  togglePlaySong: toggleSongPlayback,
  audioPlayer: songAudioPlayer
} = useSongPlayback({
  onUrlError: () => showToast(t.value.musicUrlFailed || '', 'error')
})

/** 这首歌有没有音源信息，决定封面能不能点 */
function canPlaySong(song: AnyRecord | null): boolean {
  if (!song) return false
  return Boolean((song.musicPlatform && song.musicId) || song.playUrl)
}

/** 这首歌是否正在播放（用于切换播放/暂停图标） */
function isPlayingSong(song: AnyRecord | null): boolean {
  if (!song) return false
  return songAudioPlayer.isCurrentSong(song.id) && songAudioPlayer.getPlayingStatus().value
}

async function playPostSong(post: AnyRecord) {
  if (!canPlaySong(post?.song)) return
  await toggleSongPlayback(post.song)
}

/** 子组件抛出的举报事件：统一在父组件打开举报弹窗 */
function reportComment(comment: AnyRecord) {
  openReport('COMMENT', comment.id, comment.content)
}

/**
 * 评论点赞（含子评论）：与歌曲/帖子点赞共用 voteRevealMode 偏好。
 * 本地更新 + 按点赞重排，不整页刷新。
 */
async function toggleCommentLike(comment: AnyRecord) {
  if (requireLogin()) return
  if (!comment?.id) return
  // 取消点赞不需要询问署名
  if (comment.likedByMe) {
    await submitCommentLike(comment, false)
    return
  }
  if (voteRevealMode.value === 'ANONYMOUS' || voteRevealMode.value === 'REVEAL') {
    await submitCommentLike(comment, voteRevealMode.value === 'REVEAL')
    return
  }
  pendingCommentLike.value = comment
}

async function submitCommentLike(comment: AnyRecord, reveal: boolean) {
  if (!comment?.id) return
  try {
    const res = await $fetch<AnyRecord>(`/api/community/comments/${comment.id}/like`, {
      method: 'POST',
      body: { reveal: reveal === true }
    })
    applyCommentLikeState(Number(comment.id), Boolean(res.liked), Number(res.likeCount || 0))
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  }
}

async function onCommentLikeRevealConfirm(reveal: boolean, remember: boolean) {
  const comment = pendingCommentLike.value
  pendingCommentLike.value = null
  if (!comment) return
  if (remember) {
    try {
      await $fetch('/api/user/vote-reveal', {
        method: 'PUT',
        body: { voteRevealMode: reveal ? 'REVEAL' : 'ANONYMOUS' }
      })
      voteRevealMode.value = reveal ? 'REVEAL' : 'ANONYMOUS'
    } catch {
      showToast(uiT.value.voteReveal.saveFailed, 'error')
    }
  }
  await submitCommentLike(comment, reveal)
}

function applyCommentLikeState(commentId: number, liked: boolean, likeCount: number) {
  const update = (list: AnyRecord[]) => {
    for (const node of list) {
      if (Number(node.id) === commentId) {
        node.likedByMe = liked
        node.likeCount = Math.max(0, likeCount)
      }
      if (Array.isArray(node.replies) && node.replies.length) {
        update(node.replies)
        // 点赞高的子评论排前面（同赞数按时间正序），与服务端排序口径一致
        node.replies.sort(
          (a: AnyRecord, b: AnyRecord) =>
            Number(b.likeCount || 0) - Number(a.likeCount || 0) ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
            Number(a.id) - Number(b.id)
        )
      }
    }
  }
  update(threads.value as AnyRecord[])
  for (const item of comments.value as AnyRecord[]) {
    if (Number(item.id) === commentId) {
      item.likedByMe = liked
      item.likeCount = Math.max(0, likeCount)
    }
  }
}

/** 帖子点赞与歌曲点赞共用 voteRevealMode 偏好：ASK 每次询问 / ANONYMOUS 匿名 / REVEAL 署名 */
async function togglePostLike(post: AnyRecord) {
  if (requireLogin()) return
  if (!post?.id || post.liking) return
  // 取消点赞不需要询问署名
  if (post.likedByMe) {
    await submitPostLike(post, false)
    return
  }
  if (voteRevealMode.value === 'ANONYMOUS' || voteRevealMode.value === 'REVEAL') {
    await submitPostLike(post, voteRevealMode.value === 'REVEAL')
    return
  }
  pendingPostLike.value = post
}

async function submitPostLike(post: AnyRecord, reveal: boolean) {
  if (!post?.id || post.liking) return
  post.liking = true
  try {
    const res = await $fetch<AnyRecord>(`/api/community/posts/${post.id}/like`, {
      method: 'POST',
      body: { reveal: reveal === true }
    })
    post.likedByMe = Boolean(res.liked)
    post.likeCount = Number(res.likeCount || 0)
    if (selectedPost.value?.id === post.id) {
      selectedPost.value.likedByMe = post.likedByMe
      selectedPost.value.likeCount = post.likeCount
    }
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  } finally {
    post.liking = false
  }
}

async function onPostLikeRevealConfirm(reveal: boolean, remember: boolean) {
  const post = pendingPostLike.value
  pendingPostLike.value = null
  if (!post) return
  if (remember) {
    try {
      await $fetch('/api/user/vote-reveal', {
        method: 'PUT',
        body: { voteRevealMode: reveal ? 'REVEAL' : 'ANONYMOUS' }
      })
      voteRevealMode.value = reveal ? 'REVEAL' : 'ANONYMOUS'
    } catch {
      showToast(uiT.value.voteReveal.saveFailed, 'error')
    }
  }
  await submitPostLike(post, reveal)
}

/** 管理员置顶/取消置顶 */
async function togglePin(post: AnyRecord) {
  if (!post?.id) return
  try {
    const res = await $fetch<AnyRecord>(`/api/admin/community/posts/${post.id}/pin`, {
      method: 'POST',
      body: { pinned: !post.pinned }
    })
    post.pinned = Boolean(res.pinned)
    if (selectedPost.value?.id === post.id) selectedPost.value.pinned = post.pinned
    showToast(post.pinned ? t.value.pinSuccess : t.value.unpinSuccess, 'success')
    await loadFeed(true)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  }
}

const LIKE_BLOCK_KEYS: Record<string, string> = {
  NO_ACTIVE_SEMESTER: 'likeBlockedNoActiveSemester',
  INACTIVE_SEMESTER: 'likeBlockedInactiveSemester',
  PLAYED: 'likeBlockedPlayed',
  SCHEDULED: 'likeBlockedScheduled',
  SELF: 'likeBlockedSelf',
  BLACKLIST: 'likeBlockedBlacklist'
}

function songBlockedText(song: AnyRecord | null): string {
  if (!song) return ''
  if (song.likedByMe && song.canUnvote) return ''
  if (!song.likedByMe && song.canLike) return ''
  const key = song.likeBlockedCode ? LIKE_BLOCK_KEYS[song.likeBlockedCode] : ''
  return (key ? t.value[key] : '') || song.likeBlockedReason || t.value.likeUnavailable || ''
}

function likeBlockedText(post: AnyRecord | null): string {
  return songBlockedText(post?.song)
}

/** 帖子卡片上展示的歌曲提示：只显示点不了赞的原因（黑名单等），不再展示热度去向提示 */
function songNoteText(post: AnyRecord | null): string {
  return likeBlockedText(post)
}

function canToggleLike(post: AnyRecord | null): boolean {
  const song = post?.song
  if (!song) return false
  return song.likedByMe ? !!song.canUnvote : !!song.canLike
}

function likeButtonTitle(post: AnyRecord | null): string {
  if (!post?.song) return ''
  if (post.liking) return t.value.likePending || ''
  return likeBlockedText(post) || (post.song.likedByMe ? t.value.unlike : t.value.like)
}

function applyLikeState(
  songId: number,
  liked: boolean,
  likeCount: number,
  voteCount: number,
  eligible: boolean
) {
  const update = (post: AnyRecord | null) => {
    if (!post?.song || post.song.id !== songId) return
    post.song.likedByMe = liked
    post.song.likeCount = Math.max(0, likeCount)
    post.song.voteCount = Math.max(0, voteCount)
    post.song.eligible = eligible
    post.song.canLike = !liked
    post.song.canUnvote = liked
    post.song.likeBlockedCode = null
    post.song.likeBlockedReason = null
  }
  posts.value.forEach(update)
  update(selectedPost.value)
}

async function loadVoteRevealMode() {
  try {
    const res = await $fetch<AnyRecord>('/api/user/vote-reveal')
    const mode = res?.data?.voteRevealMode
    if (mode === 'ANONYMOUS' || mode === 'REVEAL' || mode === 'ASK') voteRevealMode.value = mode
  } catch {
    // 读取偏好失败时回落到每次询问
  }
}

async function submitVote(post: AnyRecord, reveal: boolean) {
  if (!post?.song || post.liking) return
  const songId = Number(post.song.id)
  post.liking = true
  try {
    // 社区点赞与点歌页解耦：任意非黑名单歌曲都能点，只有待排期歌曲的赞同步进点歌热度
    const res = await $fetch<AnyRecord>(`/api/community/songs/${songId}/like`, {
      method: 'POST',
      body: { reveal: reveal === true }
    })
    applyLikeState(
      songId,
      Boolean(res.liked),
      Number(res.likeCount || 0),
      Number(res.voteCount || 0),
      Boolean(res.eligible)
    )
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  } finally {
    post.liking = false
  }
}

function cancelLikeReveal() {
  pendingLikePost.value = null
}

async function onLikeRevealConfirm(reveal: boolean, remember: boolean) {
  const post = pendingLikePost.value
  pendingLikePost.value = null
  if (!post) return
  if (remember) {
    try {
      await $fetch('/api/user/vote-reveal', {
        method: 'PUT',
        body: { voteRevealMode: reveal ? 'REVEAL' : 'ANONYMOUS' }
      })
      voteRevealMode.value = reveal ? 'REVEAL' : 'ANONYMOUS'
    } catch {
      showToast(uiT.value.voteReveal.saveFailed, 'error')
    }
  }
  await submitVote(post, reveal)
}

async function toggleLike(post: AnyRecord) {
  if (requireLogin()) return
  if (!post?.song || post.liking) return
  if (!canToggleLike(post)) {
    const reason = likeBlockedText(post)
    if (reason) showToast(reason, 'warning')
    return
  }

  // 取消点赞不需要询问署名
  if (post.song.likedByMe) {
    await submitVote(post, false)
    return
  }
  if (voteRevealMode.value === 'ANONYMOUS' || voteRevealMode.value === 'REVEAL') {
    await submitVote(post, voteRevealMode.value === 'REVEAL')
    return
  }

  pendingLikePost.value = post
}

function currentDraft(): PublishDraft {
  return {
    version: 1,
    boardId: Number(publishForm.boardId) || 0,
    content: String(publishForm.content || ''),
    nameMode: String(publishForm.nameMode || 'semi'),
    song: publishForm.song
      ? {
          id: publishForm.song.id,
          title: publishForm.song.title,
          artist: publishForm.song.artist,
          cover: publishForm.song.cover || ''
        }
      : null,
    images: publishForm.images as DraftImage[],
    updatedAt: Date.now()
  }
}

/** 每处变更都落草稿：已上传 id 即时持久化，刷新后可跳过重传 */
// 多次快速编辑会并发落草稿，只采用最后一次写入结果，避免旧结果覆盖提示
let draftPersistToken = 0
async function persistDraft() {
  const token = ++draftPersistToken
  const draft = currentDraft()
  const metaOk = saveDraftMeta(draft)
  const blobsOk = await saveDraftBlobs(draft.images)
  if (token === draftPersistToken) draftSaveFailed.value = !metaOk || !blobsOk
}

const hasDraftContent = computed(
  () => !!publishForm.content.trim() || (publishForm.images as DraftImage[]).length > 0
)

function releasePreviewUrls(images: DraftImage[]) {
  for (const image of images) {
    if (image.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl)
  }
}

function resetPublishForm() {
  // 作废进行中的上传：重开弹窗 / 放弃草稿 / 提交成功后，旧上传的回调不得写入新一轮表单
  uploadToken += 1
  abortUpload = true
  isUploading.value = false
  releasePreviewUrls(publishForm.images as DraftImage[])
  publishForm.boardId = activeBoardId.value || activeBoards.value[0]?.id || 0
  publishForm.content = ''
  publishForm.song = null
  publishForm.images = []
  publishForm.nameMode = nameModeOptions.value[0]?.value || 'semi'
  songQuery.value = ''
  songResults.value = []
  songSearched.value = false
  draftRestored.value = false
  discardConfirming.value = false
  uploadProgress.value = null
  uploadFailedCount.value = 0
}

async function applyDraft(draft: PublishDraft) {
  publishForm.boardId = draft.boardId || activeBoardId.value || activeBoards.value[0]?.id || 0
  publishForm.content = draft.content || ''
  publishForm.song = draft.song || null
  publishForm.nameMode = draft.nameMode || 'semi'
  // 已上传的走缩略图；未上传的用本地 Blob 预览
  publishForm.images = draft.images.map((image) => {
    if (image.id) {
      return { ...image, previewUrl: image.url ? `${image.url}?variant=preview` : undefined }
    }
    return {
      ...image,
      previewUrl: image.blob ? URL.createObjectURL(image.blob) : undefined
    }
  })
  draftRestored.value = draft.images.length > 0 || !!draft.content
}

async function openPublish() {
  if (requireLogin()) return
  if (!settings.value.enabled) return
  if (ban.value.muted) {
    showToast(t.value.muted, 'warning')
    return
  }
  resetPublishForm()
  publishOpen.value = true
  // 刷新恢复：优先还原未发布的草稿，已传成功的图直接跳过上传
  try {
    const draft = await restoreDraft()
    if (draft) {
      await applyDraft(draft)
      if (draftRestored.value) showToast(t.value.draftRestored, 'info', 3000)
      // 草稿里仍待上传的图片自动续传
      if ((publishForm.images as DraftImage[]).some((image) => !image.id && image.blob)) {
        void startUpload()
      }
    }
  } catch {
    // 草稿不可用不阻断发帖
  }
}

function closePublish() {
  if (submitting.value) return
  // 关闭不等于放弃：内容保留为草稿，下次打开继续
  if (hasDraftContent.value) persistDraft()
  publishOpen.value = false
}

/** 放弃草稿：停止上传 + 清理服务端孤儿图片 + 清本地草稿 */
async function confirmDiscardDraft() {
  if (discarding.value || isUploading.value || submitting.value) return
  discarding.value = true
  try {
    abortUpload = true
    const images = publishForm.images as DraftImage[]
    const ids = collectUploadedImageIds(images)
    if (ids.length) {
      try {
        await $fetch('/api/community/media/discard', { method: 'POST', body: { ids } })
      } catch {
        // 清理失败不阻断放弃；残留孤儿图片由后续卷级清理兜底
      }
    }
    await clearDraftBlobs()
    clearDraftMeta()
    resetPublishForm()
    uploadFailedCount.value = 0
    publishOpen.value = false
  } finally {
    discardConfirming.value = false
    discarding.value = false
  }
}

function stopUpload() {
  abortUpload = true
}

function handleSongInput() {
  if (songTimer) clearTimeout(songTimer)
  const keyword = songQuery.value.trim()
  const seq = ++songSearchSeq
  if (!keyword) {
    songResults.value = []
    songSearched.value = false
    return
  }
  songTimer = setTimeout(async () => {
    try {
      const res = await $fetch<AnyRecord>('/api/community/songs', { query: { q: keyword } })
      if (seq !== songSearchSeq) return
      songResults.value = res.songs || []
    } catch {
      if (seq !== songSearchSeq) return
      songResults.value = []
    } finally {
      if (seq === songSearchSeq) songSearched.value = true
    }
  }, 300)
}

function chooseSong(song: AnyRecord) {
  publishForm.song = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    cover: song.cover,
    canLike: song.canLike,
    canUnvote: song.canUnvote,
    likedByMe: song.likedByMe,
    likeBlockedCode: song.likeBlockedCode,
    likeBlockedReason: song.likeBlockedReason
  }
  songQuery.value = ''
  songResults.value = []
  songSearched.value = false
}

async function handleImageSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  const remaining = imageSelectionLimit.value - (publishForm.images as DraftImage[]).length
  const picked = files.slice(0, Math.max(remaining, 0))

  // 前置校验：MIME 白名单 + 文件头魔数（拦截改扩展名的伪装文件）+ 30MB 上限
  const prepared = await Promise.all(
    picked.map((file) => prepareImageFile(file, makeDraftImageKey(file)))
  )
  const accepted: DraftImage[] = []
  for (const item of prepared) {
    if (!item.valid) {
      const message =
        item.reason === 'type'
          ? t.value.imageTypeUnsupported
          : item.reason === 'too-large'
            ? t.value.imageTooLarge
            : t.value.imageContentMismatch
      showToast(message || '图片不合法', 'error')
      continue
    }
    accepted.push({
      key: item.key,
      name: item.file.name,
      size: item.file.size,
      type: item.file.type,
      blob: item.file,
      previewUrl: URL.createObjectURL(item.file)
    })
  }
  if (!accepted.length) return

  publishForm.images = mergeDraftImages(
    publishForm.images as DraftImage[],
    accepted,
    imageSelectionLimit.value
  )
  persistDraft()
  void startUpload()
}

/** 并行压缩 + 并行上传；每张成功即落草稿，实现图片级断点续传 */
async function startUpload() {
  if (isUploading.value) return
  isUploading.value = true
  abortUpload = false
  uploadFailedCount.value = 0
  const token = ++uploadToken
  uploadProgress.value = { phase: 'compressing', done: 0, total: 0, uploaded: 0, failed: 0 }
  try {
    const outcome = await uploadDraftImages({
      images: publishForm.images as DraftImage[],
      onProgress: (progress) => {
        if (token === uploadToken) uploadProgress.value = progress
      },
      onUploaded: (key, id, url, reused) => {
        if (token !== uploadToken) return
        const previous = publishForm.images as DraftImage[]
        publishForm.images = markDraftUploaded(previous, key, id, url).map((image) =>
          image.key === key
            ? { ...image, previewUrl: `${url}?variant=preview` }
            : image
        )
        // 释放本地 blob 预览，改用服务端缩略图
        const target = previous.find((image) => image.key === key)
        if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl)
        if (reused) {
          // 服务端 sha256 秒传：复用已有图片，不新增记录、不消耗额度
        }
        persistDraft()
      },
      shouldAbort: () => abortUpload || token !== uploadToken
    })
    if (token !== uploadToken) return
    uploadFailedCount.value = outcome.failedKeys.length
    if (outcome.failedKeys.length) {
      const failedMessage = t.value.imageUploadPartialFailed
      showToast(
        typeof failedMessage === 'function'
          ? failedMessage(outcome.failedKeys.length)
          : t.value.imageUploadFailed,
        'warning'
      )
    }
  } finally {
    if (token === uploadToken) {
      isUploading.value = false
      uploadProgress.value = null
      persistDraft()
    }
  }
}

async function retryFailedImages() {
  if (isUploading.value) return
  void startUpload()
}

function removeImage(key: string) {
  const images = publishForm.images as DraftImage[]
  const target = images.find((image) => image.key === key)
  if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl)
  publishForm.images = images.filter((image) => image.key !== key)
  persistDraft()
}

async function submitPost() {
  if (requireLogin()) return
  if (!canSubmit.value || submitting.value) return
  const imageIds = collectUploadedImageIds(publishForm.images as DraftImage[])
  if (!publishForm.content.trim() && !imageIds.length) return
  submitting.value = true
  try {
    const res = await $fetch<AnyRecord>('/api/community/posts', {
      method: 'POST',
      body: {
        boardId: publishForm.boardId,
        content: publishForm.content,
        nameMode: publishForm.nameMode,
        songId: publishForm.song?.id ?? null,
        imageIds
      }
    })
    publishOpen.value = false
    if (res.status === 'BLOCKED') {
      showToast(t.value.publishBlocked, 'error')
    } else if (Number(res.count) > 1 && typeof t.value.batchPublished === 'function') {
      showToast(t.value.batchPublished(Number(res.count)), 'success')
    } else {
      showToast(res.message || t.value.publishSuccess, 'success')
    }
    clearDraftMeta()
    await clearDraftBlobs()
    resetPublishForm()
    filterMine.value = true
    await loadFeed(true)
    me.value = await $fetch<AnyRecord>('/api/community/me').catch(() => me.value)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    submitting.value = false
  }
}

function askRemovePost(post: AnyRecord) {
  const withdraw = isOwnPost(post) && !canReview.value
  Object.assign(removeConfirm, {
    show: true,
    loading: false,
    kind: 'post',
    target: post,
    isDelete: !withdraw,
    title: withdraw ? t.value.withdrawPostTitle : t.value.deletePostTitle,
    message: withdraw ? t.value.withdrawPostMsg : t.value.deletePostMsg
  })
}

function askRemoveComment(comment: AnyRecord) {
  const withdraw = isOwnComment(comment) && !canReview.value
  Object.assign(removeConfirm, {
    show: true,
    loading: false,
    kind: 'comment',
    target: comment,
    isDelete: !withdraw,
    title: withdraw ? t.value.withdrawCommentTitle : t.value.deleteCommentTitle,
    message: withdraw ? t.value.withdrawCommentMsg : t.value.deleteCommentMsg
  })
}

async function runRemove(reason?: string) {
  if (!removeConfirm.target || removeConfirm.loading) return
  removeConfirm.loading = true
  const { kind, target } = removeConfirm
  try {
    const url =
      kind === 'post' ? `/api/community/posts/${target.id}` : `/api/community/comments/${target.id}`
    await $fetch(url, {
      method: 'DELETE',
      body: { reason: String(reason || '').trim() }
    })
    showToast(removeConfirm.isDelete ? t.value.deleteSuccess : t.value.withdrawSuccess, 'success')
    removeConfirm.show = false
    if (kind === 'post') {
      if (selectedPost.value?.id === target.id) closeDetail()
      await loadFeed(true)
    } else {
      comments.value = comments.value.filter((item) => item.id !== target.id)
      if (selectedPost.value && target.status === 'APPROVED') {
        selectedPost.value.commentCount = Math.max(0, Number(selectedPost.value.commentCount || 0) - 1)
        const post = posts.value.find((item) => item.id === selectedPost.value?.id)
        if (post) post.commentCount = selectedPost.value.commentCount
      }
    }
    me.value = await $fetch<AnyRecord>('/api/community/me').catch(() => me.value)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    removeConfirm.loading = false
  }
}

async function openDetail(post: AnyRecord) {
  selectedPost.value = { ...post }
  detailOpen.value = true
  comments.value = []
  threads.value = []
  commentCursor.value = null
  commentsHasMore.value = false
  commentContent.value = ''
  commentsLoading.value = true
  try {
    const [detailRes, commentRes] = await Promise.all([
      $fetch<AnyRecord>(`/api/community/posts/${post.id}`),
      $fetch<AnyRecord>(`/api/community/posts/${post.id}/comments`, {
        query: { limit: COMMENT_PAGE_SIZE }
      })
    ])
    selectedPost.value = detailRes.post
    comments.value = commentRes.comments || []
    threads.value = commentRes.threads || []
    commentsHasMore.value = Boolean(commentRes.hasMore)
    commentCursor.value = commentRes.nextCursor ?? null
    const target = posts.value.find((item) => item.id === post.id)
    if (target && detailRes.post) {
      target.viewCount = detailRes.post.viewCount
      target.likeCount = detailRes.post.likeCount
      target.likedByMe = detailRes.post.likedByMe
      target.pinned = detailRes.post.pinned
    }
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    commentsLoading.value = false
  }
}

/** 评论按顶层分页加载更多，保持楼中楼结构完整 */
async function loadMoreComments() {
  if (!selectedPost.value || commentsLoadingMore.value || !commentsHasMore.value) return
  commentsLoadingMore.value = true
  try {
    const query: AnyRecord = { limit: COMMENT_PAGE_SIZE }
    if (commentCursor.value) query.beforeId = commentCursor.value
    const res = await $fetch<AnyRecord>(`/api/community/posts/${selectedPost.value.id}/comments`, { query })
    const appendedThreads = (res.threads || []) as AnyRecord[]
    const appendedComments = (res.comments || []) as AnyRecord[]
    // 去重合并，避免游标边界重复
    const threadIds = new Set(threads.value.map((item) => item.id))
    threads.value = [...threads.value, ...appendedThreads.filter((item) => !threadIds.has(item.id))]
    const commentIds = new Set(comments.value.map((item) => item.id))
    comments.value = [...comments.value, ...appendedComments.filter((item) => !commentIds.has(item.id))]
    commentsHasMore.value = Boolean(res.hasMore)
    commentCursor.value = res.nextCursor ?? null
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    commentsLoadingMore.value = false
  }
}

function closeDetail() {
  detailOpen.value = false
  selectedPost.value = null
  replyTo.value = null
}

function startReply(comment: AnyRecord) {
  if (requireLogin()) return
  replyTo.value = comment
}

function cancelReply() {
  replyTo.value = null
}

async function sendComment() {
  if (requireLogin()) return
  const content = commentContent.value.trim()
  if (!content || sendingComment.value || !selectedPost.value) return
  sendingComment.value = true
  try {
    const result = await $fetch<AnyRecord>(`/api/community/posts/${selectedPost.value.id}/comments`, {
      method: 'POST',
      body: {
        content,
        parentId: replyTo.value?.id ?? null
      }
    })
    commentContent.value = ''
    replyTo.value = null
    const approved = result?.status === 'APPROVED'
    if (approved) {
      selectedPost.value.commentCount = Number(selectedPost.value.commentCount || 0) + 1
      const post = posts.value.find((item) => item.id === selectedPost.value?.id)
      if (post) post.commentCount = selectedPost.value.commentCount
    }
    const res = await $fetch<AnyRecord>(`/api/community/posts/${selectedPost.value.id}/comments`, {
      query: { limit: COMMENT_PAGE_SIZE }
    })
    comments.value = res.comments || []
    threads.value = res.threads || []
    commentsHasMore.value = Boolean(res.hasMore)
    commentCursor.value = res.nextCursor ?? null
    showToast(approved ? t.value.commentSuccess : t.value.commentPendingSuccess, 'success')
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    sendingComment.value = false
  }
}

async function openProfile(userId: number) {
  if (!userId) return
  profileOpen.value = true
  profileLoading.value = true
  profile.value = null
  try {
    profile.value = await $fetch<AnyRecord>(`/api/community/users/${userId}`)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
    profileOpen.value = false
  } finally {
    profileLoading.value = false
  }
}

function closeProfile() {
  profileOpen.value = false
  profile.value = null
}

function openLightbox(images: AnyRecord[], index: number) {
  lightbox.images = images
  lightbox.index = index
  lightbox.open = true
}

function closeLightbox() {
  lightbox.open = false
}

function goReview() {
  navigateTo('/dashboard?tab=community-review')
}

function goAccount() {
  profileOpen.value = false
  navigateTo('/account')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (lightbox.open) {
    closeLightbox()
  } else if (profileOpen.value) {
    closeProfile()
  } else if (detailOpen.value) {
    closeDetail()
  } else if (publishOpen.value) {
    closePublish()
  }
}

onMounted(() => {
  init()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (songTimer) clearTimeout(songTimer)
  window.removeEventListener('keydown', handleKeydown)
  stopImpressions()
  uploadToken += 1
  abortUpload = true
  isUploading.value = false
  releasePreviewUrls(publishForm.images as DraftImage[])
})
</script>

<style scoped>
.community-shell {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  height: auto;
  min-height: 0;
  padding-right: 0.25rem;
}

.community-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.community-title {
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.community-subtitle {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

.community-head-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.primary-button,
.ghost-button,
.icon-button,
.link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 0.75rem;
  font-size: 0.78rem;
  font-weight: 800;
  transition: all 0.2s ease;
  cursor: pointer;
}

.primary-button {
  padding: 0.65rem 1.1rem;
  background: var(--color-accent);
  color: #fff;
  box-shadow: 0 8px 20px var(--color-accent-alpha-30);
}

.primary-button:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.ghost-button {
  padding: 0.6rem 1rem;
  background: var(--overlay-5);
  border: 1px solid var(--overlay-10);
  color: var(--text-secondary);
}

.ghost-button:hover:not(:disabled) {
  background: var(--overlay-10);
  color: var(--text-primary);
}

.primary-button:disabled,
.ghost-button:disabled,
.like-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-button {
  width: 2.2rem;
  height: 2.2rem;
  background: var(--overlay-5);
  color: var(--text-tertiary);
}

.icon-button:hover {
  background: var(--overlay-10);
  color: var(--text-primary);
}

.link-button {
  padding: 0.35rem 0.6rem;
  color: var(--color-accent);
  background: var(--color-accent-alpha-10);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 18rem;
  padding: 2rem;
  border: 1px dashed var(--overlay-15);
  border-radius: 1.25rem;
  color: var(--text-tertiary);
  text-align: center;
}

.state-card h3 {
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 800;
}

.mute-banner,
.closed-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1rem;
  border-radius: 0.85rem;
  font-size: 0.78rem;
  font-weight: 600;
}

.mute-banner {
  background: var(--warning-light);
  border: 1px solid var(--warning-border);
  color: var(--warning);
}

.closed-banner {
  background: var(--info-light);
  border: 1px solid var(--info-border);
  color: var(--info);
}

.mute-extra {
  margin-left: 0.25rem;
  opacity: 0.9;
}

.board-rail {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.board-rail::-webkit-scrollbar {
  display: none;
}

.board-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  background: var(--overlay-5);
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 700;
  transition: all 0.2s ease;
  cursor: pointer;
}

.board-chip:hover {
  color: var(--text-primary);
  background: var(--overlay-10);
}

.board-chip.active {
  background: var(--color-accent-alpha-15);
  border-color: var(--color-accent-alpha-40);
  color: var(--color-accent);
}

.board-chip.dimmed:not(.active) {
  opacity: 0.55;
}

.board-count {
  font-size: 0.62rem;
  opacity: 0.75;
}

.community-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  gap: 1.25rem;
  align-items: start;
}

.community-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.feed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 1.8rem;
}

.feed-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}

.feed-search {
  flex: 1;
  min-width: 10rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
}

.feed-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.72rem;
}

.feed-sort {
  display: inline-flex;
  border: 1px solid var(--overlay-10);
  border-radius: 999px;
  overflow: hidden;
}

.feed-sort button {
  padding: 0.35rem 0.7rem;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.feed-sort button.active {
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
}

.pinned-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-right: 0.35rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
  font-size: 0.6rem;
  font-weight: 800;
  vertical-align: middle;
}

.footer-static {
  cursor: default;
}

.footer-static:hover {
  color: var(--text-tertiary);
}

.footer-like.liked,
.footer-like.liked:hover {
  color: #f43f5e;
}

.profile-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  color: var(--text-tertiary);
}

.feed-hint {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.mine-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
  font-size: 0.7rem;
  font-weight: 700;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mine-toggle.active {
  color: var(--color-accent);
  border-color: var(--color-accent-alpha-40);
  background: var(--color-accent-alpha-10);
}

/* 移动端点击后 :hover 会“粘住”，只在真正支持 hover 的设备上给悬停反馈 */
@media (hover: hover) {
  .mine-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-accent-alpha-40);
    background: var(--color-accent-alpha-10);
  }
}

.feed-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 12rem;
  padding: 2rem;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  text-align: center;
}

.feed-list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.post-card {
  padding: 1.1rem 1.2rem;
  border-radius: 1.1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.post-card:hover {
  border-color: var(--overlay-12);
}

.post-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.identity-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-primary);
  transition: color 0.2s ease;
}

.identity:hover .identity-name {
  color: var(--color-accent);
}

.identity-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.identity-title {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-12);
  color: var(--color-accent);
  font-size: 0.6rem;
  font-weight: 800;
}

.identity-board {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--overlay-6);
  color: var(--text-tertiary);
  font-size: 0.6rem;
  font-weight: 700;
}

.post-time {
  flex: 0 0 auto;
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.7rem;
  flex-wrap: wrap;
}

.status-pill {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 800;
  border: 1px solid transparent;
}

.status-pending {
  background: var(--warning-light);
  border-color: var(--warning-border);
  color: var(--warning);
}

.status-approved {
  background: var(--success-light);
  border-color: var(--success-border);
  color: var(--success);
}

.status-rejected,
.status-blocked {
  background: var(--error-light);
  border-color: var(--error-border);
  color: var(--error);
}

.status-note {
  font-size: 0.66rem;
  color: var(--text-tertiary);
}

.post-content {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 微信式九宫格：1 张单独展示，2/4 张两列，3 张及以上三列，统一正方形缩略图，避免占满屏幕 */
.post-images {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.85rem;
  max-width: 21rem;
}

.post-images.images-1 {
  grid-template-columns: minmax(0, 1fr);
  max-width: min(100%, 18rem);
}

.post-images.images-2,
.post-images.images-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.post-images.images-3,
.post-images.images-many {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.image-button {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  overflow: hidden;
  cursor: zoom-in;
  background: var(--overlay-5);
}

.image-button img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  aspect-ratio: 1 / 1;
  transition: transform 0.3s ease;
}

/* 朋友圈式图片展示：
   - 单图按原始宽高比完整呈现，只限制最大宽高，不裁切（修复列表里「显示不全」）
   - 多图保持方形宫格缩略图，点开灯箱可看完整原图（.lightbox 内为 object-fit: contain） */
.post-images.images-1 .image-button {
  max-width: 100%;
}

.post-images.images-1 .image-button img {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 22rem;
  object-fit: contain;
  aspect-ratio: auto;
}

.post-images.images-1 .image-button:hover img {
  transform: none;
}

.image-button:hover img {
  transform: scale(1.03);
}

.song-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.85rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.9rem;
  background: var(--overlay-4);
  border: 1px solid var(--overlay-6);
}

.song-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.55rem;
  overflow: hidden;
  background: var(--overlay-8);
  color: var(--text-tertiary);
}

/* 有音源信息的歌曲封面可点击播放，沿用投稿列表的悬停浮层 */
.song-cover.is-playable {
  position: relative;
  cursor: pointer;
}

.play-button-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mask-40);
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.song-cover.is-playable:hover .play-button-overlay {
  opacity: 1;
}

.song-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.song-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.song-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-artist {
  font-size: 0.66rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-note {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--warning);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.like-button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.like-button:hover {
  color: #f43f5e;
  border-color: var(--error-border);
}

.like-button.liked {
  color: #f43f5e;
  background: var(--error-light);
  border-color: var(--error-border);
}

.post-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--overlay-4);
}

.footer-action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s ease;
}

.footer-action:hover {
  color: var(--color-accent);
}

.footer-danger {
  margin-left: auto;
  color: var(--text-quaternary);
}

.footer-danger:hover {
  color: var(--error);
}

.detail-head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.detail-remove {
  padding: 0.4rem 0.7rem;
  font-size: 0.7rem;
}

.detail-remove:hover {
  color: var(--error);
  border-color: var(--error-border);
}

.load-more-row {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 1rem;
}

.community-aside {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  position: sticky;
  top: 0;
}

.me-card,
.rules-card {
  padding: 1rem;
  border-radius: 1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
}

.me-identity,
.profile-identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.me-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-15);
  color: var(--color-accent);
  flex: 0 0 auto;
}

.me-name,
.profile-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-primary);
  word-break: break-all;
}

.me-title {
  margin-top: 0.15rem;
  font-size: 0.62rem;
  font-weight: 800;
  color: var(--color-accent);
}

.me-stats,
.profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.9rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--overlay-4);
  border-bottom: 1px solid var(--overlay-4);
}

.me-stats > div,
.profile-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: center;
}

.me-stat-value {
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-primary);
}

.me-stat-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.me-violation {
  margin-top: 0.6rem;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--warning);
}

.me-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.8rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.7rem;
  background: var(--overlay-5);
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 700;
  transition: all 0.2s ease;
}

.me-link:hover {
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
}

.rules-card h3 {
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.rules-card p {
  font-size: 0.66rem;
  line-height: 1.7;
  color: var(--text-tertiary);
}

.rules-card p + p {
  margin-top: 0.35rem;
}

/* 弹层 */
.modal-layer {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--bg-primary-80, rgba(0, 0, 0, 0.72));
  backdrop-filter: blur(6px);
}

.modal-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(86vh, 46rem);
  border-radius: 1.35rem;
  background: var(--panel-bg-dialog);
  border: 1px solid var(--overlay-10);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.publish-card {
  max-width: 34rem;
}

.detail-card {
  max-width: 36rem;
}

.profile-card {
  max-width: 30rem;
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.1rem 1.2rem;
  border-bottom: 1px solid var(--overlay-6);
}

.modal-head h3 {
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-primary);
}

.modal-head p {
  margin-top: 0.2rem;
  font-size: 0.7rem;
  color: var(--text-tertiary);
}

.detail-head-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.1rem 1.2rem;
  overflow-y: auto;
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1.2rem;
  border-top: 1px solid var(--overlay-6);
  background: var(--overlay-2);
}

.foot-hint {
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.publish-as {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-radius: 0.7rem;
  background: var(--overlay-4);
  font-size: 0.7rem;
}

.publish-as-label {
  color: var(--text-tertiary);
}

.publish-as-name {
  font-weight: 800;
  color: var(--text-primary);
}

.board-picker {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--text-secondary);
}

.field-title-extra {
  margin-left: auto;
  color: var(--text-quaternary);
  font-size: 0.64rem;
}

.field textarea {
  width: 100%;
  min-height: 7rem;
  resize: vertical;
  padding: 0.8rem 0.9rem;
  border-radius: 0.85rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-primary);
  font-size: 0.86rem;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.2s ease;
}

.field textarea::placeholder {
  color: var(--text-quaternary);
}

.field textarea:focus {
  border-color: var(--color-accent-alpha-50);
}

.field-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.62rem;
  color: var(--text-quaternary);
}

.field-hint {
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-tertiary);
}

.search-field input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.8rem;
}

.search-field input::placeholder {
  color: var(--text-quaternary);
}

.song-results {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.35rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-8);
  background: var(--overlay-2);
}

.song-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 0.6rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.74rem;
  cursor: pointer;
  text-align: left;
}

.song-result:hover {
  background: var(--overlay-8);
}

.song-result-title {
  font-weight: 700;
  color: var(--text-primary);
}

.song-result-artist {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-result-liked {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--error-light);
  color: #f43f5e;
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-own {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--overlay-8);
  color: var(--text-tertiary);
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-blocked {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--warning-light);
  color: var(--warning);
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-pick {
  margin-left: auto;
  color: var(--color-accent);
  font-weight: 800;
  flex: 0 0 auto;
}

.selected-song {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.8rem;
  border: 1px solid var(--color-accent-alpha-25);
  background: var(--color-accent-alpha-10);
}

.image-uploader {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.upload-thumb {
  position: relative;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 0.7rem;
  overflow: hidden;
  border: 1px solid var(--overlay-10);
}

.upload-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.upload-thumb.is-pending img {
  opacity: 0.6;
}

.thumb-pending {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.1rem 0;
  text-align: center;
  font-size: 0.55rem;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.55rem;
  font-size: 0.64rem;
  color: var(--text-tertiary);
}

.upload-progress-track {
  flex: 1;
  height: 0.3rem;
  border-radius: 999px;
  background: var(--overlay-8);
  overflow: hidden;
}

.upload-progress-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--primary, #6366f1);
  transition: width 0.2s ease;
}

.upload-retry {
  margin-top: 0.45rem;
}

.discard-confirm .foot-hint {
  color: var(--warning, #d97706);
}

.thumb-remove {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}

.upload-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 0.7rem;
  border: 1px dashed var(--overlay-20);
  background: var(--overlay-3);
  color: var(--text-tertiary);
  font-size: 0.58rem;
  font-weight: 700;
  cursor: pointer;
}

.upload-add:hover:not(:disabled) {
  border-color: var(--color-accent-alpha-50);
  color: var(--color-accent);
}

.hidden-input {
  display: none;
}

.muted-text {
  font-size: 0.72rem;
  color: var(--text-quaternary);
}

.detail-body {
  gap: 0.85rem;
}

.detail-identity {
  align-self: stretch;
}

.detail-content {
  font-size: 0.92rem;
}

.detail-note {
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  background: var(--overlay-4);
  border-left: 3px solid var(--text-quaternary);
}

.detail-note span {
  font-size: 0.6rem;
  font-weight: 800;
  color: var(--text-tertiary);
}

.detail-note p {
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.comment-section {
  padding-top: 0.4rem;
  border-top: 1px solid var(--overlay-6);
}

.comment-section h4 {
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--text-secondary);
  margin-bottom: 0.6rem;
}

.comment-empty {
  font-size: 0.72rem;
  color: var(--text-quaternary);
  padding: 0.8rem 0;
  text-align: center;
}

.comment-replies {
  margin-top: 0.6rem;
  padding-left: 0.75rem;
  border-left: 2px solid var(--overlay-8);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.comment-reply-item {
  background: var(--overlay-4);
  border-radius: 0.6rem;
  padding: 0.5rem 0.6rem;
}

.comment-reply-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.68rem;
  font-weight: 700;
  cursor: pointer;
}

.comment-reply-btn:hover {
  color: var(--color-accent);
}

.reply-target {
  font-size: 0.62rem;
  color: var(--text-disabled);
}

.mention-name {
  color: var(--color-accent);
  font-weight: 700;
}

.reply-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: 100%;
  padding: 0.35rem 0.6rem;
  border-radius: 0.6rem;
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
  font-size: 0.68rem;
  font-weight: 700;
}

.reply-chip button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
}

.mention-hint {
  margin-top: 0.35rem;
  font-size: 0.62rem;
  color: var(--text-disabled);
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  max-height: 16rem;
  overflow-y: auto;
}

.comment-item {
  padding: 0.6rem 0.7rem;
  border-radius: 0.75rem;
  background: var(--overlay-3);
}

.comment-item p {
  margin-top: 0.35rem;
  font-size: 0.76rem;
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}

.comment-identity {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}

.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.comment-tail {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.comment-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.45rem;
  border: none;
  background: transparent;
  color: var(--text-quaternary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.comment-remove:hover {
  color: var(--error);
  background: var(--error-light);
}

.comment-note {
  margin-top: 0.3rem;
  font-size: 0.66rem;
  color: var(--warning);
}

.comment-identity .identity-name {
  font-size: 0.7rem;
}

.comment-time {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.6rem;
  color: var(--text-quaternary);
}

.comment-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1.2rem;
  border-top: 1px solid var(--overlay-6);
  background: var(--overlay-2);
}

.comment-input {
  flex: 1;
  min-width: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-primary);
  font-size: 0.8rem;
  outline: none;
}

.comment-input::placeholder {
  color: var(--text-quaternary);
}

.comment-input:focus {
  border-color: var(--color-accent-alpha-50);
}

.comment-send {
  flex: 0 0 auto;
}

.profile-avatar {
  width: 3.4rem;
  height: 3.4rem;
}

.profile-joined {
  margin-top: 0.2rem;
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.profile-section {
  padding-top: 0.7rem;
  border-top: 1px solid var(--overlay-6);
}

.profile-section h4 {
  font-size: 0.7rem;
  font-weight: 900;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.liked-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 12rem;
  overflow-y: auto;
}

.liked-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.6rem;
  background: var(--overlay-3);
}

.liked-cover {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 0.4rem;
}

.liked-item .song-artist {
  margin-left: auto;
}

.profile-account-link {
  align-self: flex-start;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  background: rgba(0, 0, 0, 0.9);
}

.lightbox img {
  max-width: min(92vw, 70rem);
  max-height: 86vh;
  object-fit: contain;
  border-radius: 0.6rem;
}

.lightbox-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.lightbox-prev {
  left: 1rem;
}

.lightbox-next {
  right: 1rem;
}

.lightbox-counter {
  position: absolute;
  bottom: 1.2rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.75);
}

.community-fade-enter-active,
.community-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.community-fade-enter-from,
.community-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 1024px) {
  .community-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .community-aside {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .community-shell {
    padding-right: 0;
    gap: 1rem;
  }

  .community-title {
    font-size: 1.3rem;
  }

  .community-head {
    align-items: flex-start;
  }

  .community-head-actions {
    width: 100%;
  }

  .community-head-actions .primary-button {
    flex: 1;
  }

  .community-aside {
    grid-template-columns: minmax(0, 1fr);
  }

  .post-card {
    padding: 0.95rem 1rem;
  }

  .post-images {
    max-width: 100%;
  }

  .modal-layer {
    align-items: flex-end;
    padding: 0;
  }

  .modal-card {
    max-height: 92vh;
    border-radius: 1.35rem 1.35rem 0 0;
    border-bottom: none;
  }

  .publish-card,
  .detail-card,
  .profile-card {
    max-width: 100%;
  }

  .comment-list {
    max-height: 12rem;
  }

  .lightbox {
    padding: 1rem;
  }

  .lightbox-nav {
    width: 2.25rem;
    height: 2.25rem;
  }

  .lightbox-prev {
    left: 0.4rem;
  }

  .lightbox-next {
    right: 0.4rem;
  }
}

@media (max-width: 480px) {
  .modal-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .foot-hint {
    text-align: center;
  }

  .foot-actions {
    margin-left: 0;
  }

  .foot-actions .primary-button {
    flex: 1;
  }

  .comment-foot {
    padding: 0.7rem;
  }

  .comment-send span {
    display: none;
  }
}
</style>
